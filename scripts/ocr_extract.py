#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Vision-language model (VLM) powered extraction pipeline.

The script prepares image + prompt payloads for a remote VLM, captures the
model response, and normalizes the returned key/value pairs into
`structured.json` so the Next.js layer can persist the parsed fields. Previous
iterations depended on PaddleOCR for local text extraction; that dependency has
been removed so the workflow now relies entirely on the configured VLM.

Provider routing:
- providerType == "huggingface"    -> huggingface_hub.InferenceClient
- providerType == "openai"         -> openai.OpenAI
- providerType == "azure-openai"   -> openai.AzureOpenAI
- otherwise                        -> raw urllib (OpenAI-compatible / generic HTTP)
"""

from __future__ import annotations

import os, re, sys, json, argparse, base64, mimetypes
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union
from collections import OrderedDict
from urllib import request as urllib_request, error as urllib_error
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

# --------------------------
# Constants
# --------------------------
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
DEFAULT_MODEL = "Qwen/Qwen3-VL-2B-Instruct"
HF_ROUTER_BASE = "https://router.huggingface.co"  # kept for generic HTTP path if you ever need it
DEFAULT_LOCAL_MAX_NEW_TOKENS = 512

BASE_EXTRACTION_PROMPT = (
    "You are given a shipping/order IMAGE and its OCR transcript.\n"
    "Extract all the key values and return two JSON bodies.\n"
    "1. A JSON (\"all_key_values\") containing all the key values on the order sheet without missing any.\n"
    "2. A JSON (\"selected_key_values\") returning these key values: Destination, Item Name, Tracking/Order ID, Truck Number, Ship Date, Expected Departure Time, Origin.\n"
    "Respond with a single JSON object that includes both keys. Do not wrap the output in code fences."
)

# --------------------------
# Config helpers
# --------------------------
def load_remote_config() -> Optional[Dict[str, Any]]:
    raw = os.environ.get("VLM_REMOTE_CONFIG")
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        print("[warn] Failed to parse VLM_REMOTE_CONFIG", file=sys.stderr)
        return None

def normalize_hf_base_url(value: Optional[str]) -> str:
    # Kept for generic HTTP mode; not used by the HF SDK path.
    if not isinstance(value, str):
        return ""
    trimmed = value.strip()
    if not trimmed:
        return ""
    trimmed = trimmed.rstrip("/")
    deprecated_prefix = "https://api-inference.huggingface.co"
    if trimmed.startswith(deprecated_prefix):
        suffix = trimmed[len(deprecated_prefix):].lstrip("/")
        return f"{HF_ROUTER_BASE}/{suffix}" if suffix else HF_ROUTER_BASE
    router_deprecated = f"{HF_ROUTER_BASE}/hf-inference"
    if trimmed.startswith(router_deprecated):
        suffix = trimmed[len(router_deprecated):].lstrip("/")
        return f"{HF_ROUTER_BASE}/{suffix}" if suffix else HF_ROUTER_BASE
    return trimmed

def ensure_chat_completions_url(base_url: str) -> str:
    if not isinstance(base_url, str) or not base_url.strip():
        raise ValueError("Base URL is required for remote VLM calls")
    parts = urlsplit(base_url.strip())
    if not parts.scheme or not parts.netloc:
        raise ValueError("Base URL must include a scheme and host")
    path = parts.path or ""
    trimmed = path.rstrip("/")
    if trimmed.endswith("/chat/completions"):
        final_path = trimmed
    elif trimmed.endswith("/v1"):
        final_path = trimmed + "/chat/completions"
    else:
        final_path = (trimmed + "/v1/chat/completions") if trimmed else "/v1/chat/completions"
    if not final_path.startswith("/"):
        final_path = "/" + final_path
    return urlunsplit((parts.scheme, parts.netloc, final_path, parts.query, parts.fragment))

def append_query_params(url: str, params: Dict[str, Optional[str]]) -> str:
    if not params:
        return url
    parts = urlsplit(url)
    query_pairs = parse_qsl(parts.query, keep_blank_values=True)
    query_map: Dict[str, str] = {key: val for key, val in query_pairs}
    changed = False
    for key, value in params.items():
        if value is None or value == "":
            continue
        query_map[key] = value
        changed = True
    if not changed:
        return url
    new_query = urlencode(query_map)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, new_query, parts.fragment))

# --------------------------
# I/O utils
# --------------------------
def safe_mkdir(d: str):
    if d:
        Path(d).mkdir(parents=True, exist_ok=True)

def guess_mime(p: str) -> str:
    mime, _ = mimetypes.guess_type(p)
    return mime or "image/jpeg"

def encode_image_to_base64(image_path: str) -> str:
    # Keeping base64 data URI for compatibility — HF SDK handles large payloads via multipart/stream.
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    return f"data:{guess_mime(image_path)};base64,{b64}"

# --------------------------
# JSON path helpers
# --------------------------
def parse_path_tokens(path: str) -> List[Union[str, int]]:
    tokens: List[Union[str, int]] = []
    buf = ""
    i = 0
    while i < len(path):
        ch = path[i]
        if ch == ".":
            if buf:
                tokens.append(buf); buf = ""
            i += 1; continue
        if ch == "[":
            if buf:
                tokens.append(buf); buf = ""
            j = path.find("]", i)
            if j == -1: break
            idx_str = path[i+1:j].strip()
            if idx_str.isdigit():
                tokens.append(int(idx_str))
            i = j + 1; continue
        buf += ch; i += 1
    if buf:
        tokens.append(buf)
    return tokens

def extract_json_path(data: Any, path: str) -> Any:
    if not path:
        return data
    current = data
    for token in parse_path_tokens(path):
        if isinstance(token, int):
            if isinstance(current, (list, tuple)) and 0 <= token < len(current):
                current = current[token]
            else:
                return None
        else:
            if isinstance(current, dict):
                current = current.get(token)
            else:
                return None
        if current is None:
            return None
    return current

# --------------------------
# HTTP header builder
# --------------------------
def build_http_headers(remote_cfg: Dict[str, Any]) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    scheme = str(remote_cfg.get("authScheme") or "bearer").lower()
    header_name = str(remote_cfg.get("authHeaderName") or "Authorization")
    api_key = remote_cfg.get("apiKey")
    if isinstance(api_key, str) and api_key:
        if scheme == "bearer":
            headers[header_name] = api_key if api_key.lower().startswith("bearer ") else f"Bearer {api_key}"
        elif scheme == "api-key-header":
            headers[header_name] = api_key
        elif scheme == "basic":
            encoded = base64.b64encode(api_key.encode("utf-8")).decode("ascii")
            headers[header_name] = f"Basic {encoded}"
    extra_headers = remote_cfg.get("extraHeaders")
    if isinstance(extra_headers, list):
        for entry in extra_headers:
            if not isinstance(entry, dict):
                continue
            key = str(entry.get("key") or "").strip()
            val = str(entry.get("value") or "").strip()
            if key and val:
                headers[key] = val
    headers.setdefault("Content-Type", "application/json")
    headers.setdefault("Accept", "application/json")
    return headers

# --------------------------
# Message builder
# --------------------------
def build_vlm_messages(
    image_path: str,
    ocr_txt: Optional[str] = None,
    system_prompt: Optional[str] = None,
) -> List[Dict[str, Any]]:
    img_b64 = encode_image_to_base64(image_path)
    instruction = BASE_EXTRACTION_PROMPT
    user_content = [
        {"type": "text", "text": instruction},
        {"type": "image_url", "image_url": {"url": img_b64}},
    ]
    cleaned_txt = (ocr_txt or "").strip()
    if cleaned_txt:
        user_content.append({"type": "text", "text": "OCR_TEXT_BEGIN\n" + cleaned_txt + "\nOCR_TEXT_END"})
    else:
        user_content.append({
            "type": "text",
            "text": (
                "No OCR transcript is available. Use the visual content of the image to"
                " extract header key/value pairs."
            ),
        })
    user_content.append({"type": "text", "text": "OUTPUT: JSON only."})
    messages: List[Dict[str, Any]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": user_content})
    return messages

def parse_bool(value: Optional[str], default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in {"1", "true", "yes", "on"}

def compose_prompt_text(system_prompt: Optional[str], ocr_txt: Optional[str]) -> str:
    parts: List[str] = []
    if isinstance(system_prompt, str):
        stripped = system_prompt.strip()
        if stripped:
            parts.append(stripped)
    parts.append(BASE_EXTRACTION_PROMPT)
    cleaned_txt = (ocr_txt or "").strip()
    if cleaned_txt:
        parts.append("OCR_TEXT_BEGIN\n" + cleaned_txt + "\nOCR_TEXT_END")
    else:
        parts.append(
            "No OCR transcript is available. Use the visual content of the image to extract header key/value pairs."
        )
    parts.append("OUTPUT: JSON only.")
    return "\n\n".join(parts)

def build_local_vlm_call(
    model_id: str,
    dtype: str,
    device_map: str,
    max_new_tokens: int,
    attn_impl: Optional[str],
    system_prompt: Optional[str],
) -> Callable[[str, Optional[str]], str]:
    try:
        import torch
    except ImportError as ie:
        raise RuntimeError(
            "torch is required for local VLM execution. Install with: pip install torch"
        ) from ie

    try:
        from transformers import (
            AutoModelForCausalLM,
            AutoModelForVision2Seq,
            AutoProcessor,
        )
    except ImportError as ie:
        raise RuntimeError(
            "transformers is required for local VLM execution. Install with: pip install transformers"
        ) from ie

    try:
        from PIL import Image
    except ImportError as ie:
        raise RuntimeError(
            "Pillow is required for local VLM execution. Install with: pip install pillow"
        ) from ie

    try:
        from transformers import Qwen2VLForConditionalGeneration  # type: ignore
    except ImportError:
        Qwen2VLForConditionalGeneration = None  # type: ignore

    try:
        from transformers import Qwen3VLForConditionalGeneration  # type: ignore
    except ImportError:
        Qwen3VLForConditionalGeneration = None  # type: ignore

    normalized_model = (model_id or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    dtype_key = (dtype or "auto").strip().lower()
    dtype_mapping: Dict[str, Any] = {
        "auto": "auto",
        "float16": torch.float16,
        "fp16": torch.float16,
        "half": torch.float16,
        "bfloat16": torch.bfloat16,
        "bf16": torch.bfloat16,
        "float32": torch.float32,
        "fp32": torch.float32,
    }
    torch_dtype = dtype_mapping.get(dtype_key, "auto")
    if torch_dtype == "auto" and dtype_key not in {"auto", ""}:
        print(f"[warn] Unsupported dtype '{dtype}'. Falling back to auto.", file=sys.stderr)

    device_map_clean = (device_map or "auto").strip() or "auto"
    attn_impl_clean = (attn_impl or "").strip()
    tokens = max(1, int(max_new_tokens or DEFAULT_LOCAL_MAX_NEW_TOKENS))

    loaders: List[Any] = []
    lowered = normalized_model.lower()
    if "qwen3" in lowered and Qwen3VLForConditionalGeneration is not None:
        loaders.append(Qwen3VLForConditionalGeneration)
    if "qwen2" in lowered and Qwen2VLForConditionalGeneration is not None:
        loaders.append(Qwen2VLForConditionalGeneration)
    for candidate in (AutoModelForVision2Seq, AutoModelForCausalLM):
        if candidate is not None and candidate not in loaders:
            loaders.append(candidate)

    if not loaders:
        raise RuntimeError("No suitable model loader available from transformers.")

    def attempt_load(loader: Any) -> Any:
        base_kwargs: Dict[str, Any] = {"trust_remote_code": True}
        if device_map_clean:
            base_kwargs["device_map"] = device_map_clean
        if torch_dtype != "auto":
            base_kwargs["torch_dtype"] = torch_dtype
        if attn_impl_clean:
            base_kwargs["attn_implementation"] = attn_impl_clean

        try:
            return loader.from_pretrained(normalized_model, **base_kwargs)
        except TypeError as exc:
            msg = str(exc).lower()
            adjusted = dict(base_kwargs)
            if "attn_implementation" in adjusted and "attn_implementation" in msg:
                adjusted.pop("attn_implementation", None)
                return loader.from_pretrained(normalized_model, **adjusted)
            if "device_map" in adjusted and "device_map" in msg:
                device_hint = adjusted.pop("device_map", None)
                model = loader.from_pretrained(normalized_model, **adjusted)
                if device_hint and device_hint not in {"auto", ""}:
                    try:
                        model.to(device_hint)
                    except Exception:
                        pass
                return model
            raise

    last_error: Optional[Exception] = None
    model = None
    for loader in loaders:
        try:
            model = attempt_load(loader)
            break
        except Exception as exc:  # pragma: no cover - debugging helper
            last_error = exc
            continue

    if model is None:
        detail = f": {last_error}" if last_error else ""
        raise RuntimeError(f"Failed to load local model '{normalized_model}'{detail}")

    model.eval()

    processor = AutoProcessor.from_pretrained(normalized_model, trust_remote_code=True)
    tokenizer = getattr(processor, "tokenizer", None)
    if tokenizer is not None and getattr(tokenizer, "pad_token_id", None) is None:
        eos_id = getattr(tokenizer, "eos_token_id", None)
        if eos_id is not None:
            tokenizer.pad_token_id = eos_id

    try:
        first_param = next(model.parameters())
        target_device = first_param.device
    except StopIteration:
        target_device = torch.device(device_map_clean if device_map_clean else "cpu")
    except Exception:
        target_device = torch.device("cpu")

    prompt_cache = system_prompt

    def move_batch(batch: Any) -> Any:
        if hasattr(batch, "to"):
            return batch.to(target_device)
        if isinstance(batch, dict):
            return {k: move_batch(v) for k, v in batch.items()}
        return batch

    def local_vlm(image_path: str, ocr_txt: Optional[str]) -> str:
        prompt = compose_prompt_text(prompt_cache, ocr_txt)
        try:
            with Image.open(image_path) as img:
                image = img.convert("RGB")
                inputs = processor(text=prompt, images=[image], return_tensors="pt")
        except Exception as exc:
            raise RuntimeError(f"Failed to prepare inputs for {image_path}: {exc}") from exc

        inputs = move_batch(inputs)

        try:
            with torch.no_grad():
                generated = model.generate(**inputs, max_new_tokens=tokens)
        except Exception as exc:
            raise RuntimeError(f"Generation failed: {exc}") from exc

        input_ids = inputs.get("input_ids") if isinstance(inputs, dict) else getattr(inputs, "input_ids", None)
        trimmed_sequences: List[Any] = []

        if isinstance(generated, torch.Tensor):
            generated_cpu = generated.detach().to("cpu")
            if input_ids is not None:
                input_cpu = input_ids.detach().to("cpu")
                for in_ids, out_ids in zip(input_cpu, generated_cpu):
                    trimmed_sequences.append(out_ids[len(in_ids) :])
            else:
                trimmed_sequences = [seq for seq in generated_cpu]
        else:
            trimmed_sequences = list(generated)

        try:
            decoded = processor.batch_decode(
                trimmed_sequences,
                skip_special_tokens=True,
                clean_up_tokenization_spaces=False,
            )
        except Exception as exc:
            raise RuntimeError(f"Decoding failed: {exc}") from exc

        if not decoded:
            return ""
        return decoded[0].strip()

    return local_vlm

# --------------------------
# Local model availability check
# --------------------------
def ensure_local_model_available(model_id: str) -> None:
    normalized = (model_id or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    print(f"[check] Verifying local cache for '{normalized}'…")

    try:
        from huggingface_hub import snapshot_download  # type: ignore
        from huggingface_hub.utils import LocalEntryNotFoundError  # type: ignore
    except ImportError as exc:  # pragma: no cover - safety path when deps missing
        raise RuntimeError(
            "huggingface_hub is required to confirm local model availability. "
            "Install it with: pip install --upgrade huggingface_hub"
        ) from exc

    try:
        cache_path = snapshot_download(
            normalized,
            local_files_only=True,
            allow_patterns=None,
        )
    except LocalEntryNotFoundError as exc:
        instructions = (
            f"Local model '{normalized}' is not cached on this machine.\n"
            "Download the weights before scanning. Examples:\n"
            f"  • huggingface-cli download {normalized} --local-dir ./models/{normalized.replace('/', '_')}\n"
            f"  • python -c \"from huggingface_hub import snapshot_download; snapshot_download('{normalized}')\"\n"
            "After the download completes, rerun the scanner."
        )
        raise RuntimeError(instructions) from exc
    except Exception as exc:
        raise RuntimeError(f"Unable to verify local model '{normalized}': {exc}") from exc

    if cache_path:
        print(f"[info] Found cached weights under {cache_path}")

# --------------------------
# Provider-dispatched VLM call
# --------------------------
def call_http_vlm(
    remote_cfg: Dict[str, Any],
    base_url: str,
    model: str,
    messages: List[Dict[str, Any]],
    defaults: Dict[str, Any],
) -> str:
    """
    Dispatch to:
      - Hugging Face -> huggingface_hub.InferenceClient
      - OpenAI / Azure OpenAI -> openai SDK
      - Else -> raw urllib POST to OpenAI-compatible / generic HTTP
    """
    provider_type = str(remote_cfg.get("providerType") or "").lower()
    provider_hint = str(remote_cfg.get("hfProvider") or "").strip()
    request_url = (base_url or "").strip()

    # ------------------ Hugging Face via SDK ------------------
    if provider_type == "huggingface":
        try:
            from huggingface_hub import InferenceClient
        except ImportError as ie:
            raise RuntimeError(
                "huggingface_hub is required for providerType=huggingface. "
                "Install with: pip install --upgrade huggingface_hub"
            ) from ie

        client = InferenceClient(
            provider=provider_hint or None,
            api_key=(remote_cfg.get("apiKey") or os.environ.get("HF_TOKEN")),
        )

        # Standard OpenAI-compatible kwargs
        std_kwargs: Dict[str, Any] = {}
        if isinstance(defaults.get("temperature"), (int, float)):
            std_kwargs["temperature"] = float(defaults["temperature"])
        if isinstance(defaults.get("maxOutputTokens"), (int, float)):
            std_kwargs["max_tokens"] = int(defaults["maxOutputTokens"])
        if isinstance(defaults.get("topP"), (int, float)):
            std_kwargs["top_p"] = float(defaults["topP"])
        if isinstance(defaults.get("seed"), (int, float)):
            std_kwargs["seed"] = int(defaults["seed"])
        if defaults.get("jsonMode"):
            std_kwargs["response_format"] = {"type": "json_object"}
            schema_raw = defaults.get("jsonSchema")
            if isinstance(schema_raw, str) and schema_raw.strip():
                try:
                    std_kwargs["response_format"]["schema"] = json.loads(schema_raw)
                except Exception:
                    pass
        stop_sequences = defaults.get("stopSequences")
        if isinstance(stop_sequences, list) and stop_sequences:
            std_kwargs["stop"] = stop_sequences

        # Provider-specific via extra_body
        extra_body: Dict[str, Any] = {}
        if isinstance(defaults.get("topK"), (int, float)):
            extra_body["top_k"] = int(defaults["topK"])
        if isinstance(defaults.get("repetitionPenalty"), (int, float)):
            extra_body["repetition_penalty"] = float(defaults["repetitionPenalty"])

        try:
            completion = client.chat.completions.create(
                model=model,
                messages=messages,
                stream=False,
                **std_kwargs,
                **({"extra_body": extra_body} if extra_body else {}),
            )
        except Exception as exc:
            raise RuntimeError(f"Hugging Face call failed: {exc}") from exc

        return to_str_content(completion.choices[0].message)

    # ------------------ OpenAI (official SDK) ------------------
    if provider_type == "openai":
        try:
            from openai import OpenAI
        except ImportError as ie:
            raise RuntimeError(
                "openai is required for providerType=openai. Install with: pip install --upgrade openai"
            ) from ie

        api_key = remote_cfg.get("apiKey") or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OpenAI API key missing (set remote_cfg.apiKey or OPENAI_API_KEY).")

        client = OpenAI(api_key=api_key, base_url=request_url or None)

        std_kwargs: Dict[str, Any] = {}
        if isinstance(defaults.get("temperature"), (int, float)):
            std_kwargs["temperature"] = float(defaults["temperature"])
        if isinstance(defaults.get("maxOutputTokens"), (int, float)):
            std_kwargs["max_tokens"] = int(defaults["maxOutputTokens"])
        if isinstance(defaults.get("topP"), (int, float)):
            std_kwargs["top_p"] = float(defaults["topP"])
        if defaults.get("jsonMode"):
            std_kwargs["response_format"] = {"type": "json_object"}
        stop_sequences = defaults.get("stopSequences")
        if isinstance(stop_sequences, list) and stop_sequences:
            std_kwargs["stop"] = stop_sequences

        try:
            completion = client.chat.completions.create(
                model=model,
                messages=messages,
                stream=False,
                **std_kwargs,
            )
        except Exception as exc:
            raise RuntimeError(f"OpenAI call failed: {exc}") from exc

        return to_str_content(completion.choices[0].message)

    # ------------------ Azure OpenAI (official SDK) ------------------
    if provider_type == "azure-openai":
        try:
            from openai import AzureOpenAI
        except ImportError as ie:
            raise RuntimeError(
                "openai is required for providerType=azure-openai. Install with: pip install --upgrade openai"
            ) from ie

        api_key = (
            remote_cfg.get("apiKey")
            or os.environ.get("AZURE_OPENAI_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
        )
        if not api_key:
            raise RuntimeError("Azure OpenAI API key missing (set remote_cfg.apiKey or AZURE_OPENAI_API_KEY).")

        azure_endpoint = request_url or remote_cfg.get("azureEndpoint") or remote_cfg.get("baseUrl")
        if not azure_endpoint:
            raise RuntimeError("Azure endpoint missing (set remote_cfg.baseUrl or remote_cfg.azureEndpoint).")

        api_version = str(remote_cfg.get("apiVersion") or "2024-02-15-preview")

        # For Azure, `model` is the deployment name.
        client = AzureOpenAI(api_key=api_key, azure_endpoint=azure_endpoint, api_version=api_version)

        std_kwargs: Dict[str, Any] = {}
        if isinstance(defaults.get("temperature"), (int, float)):
            std_kwargs["temperature"] = float(defaults["temperature"])
        if isinstance(defaults.get("maxOutputTokens"), (int, float)):
            std_kwargs["max_tokens"] = int(defaults["maxOutputTokens"])
        if isinstance(defaults.get("topP"), (int, float)):
            std_kwargs["top_p"] = float(defaults["topP"])
        if defaults.get("jsonMode"):
            std_kwargs["response_format"] = {"type": "json_object"}
        stop_sequences = defaults.get("stopSequences")
        if isinstance(stop_sequences, list) and stop_sequences:
            std_kwargs["stop"] = stop_sequences

        try:
            completion = client.chat.completions.create(
                model=model,   # deployment name
                messages=messages,
                stream=False,
                **std_kwargs,
            )
        except Exception as exc:
            raise RuntimeError(f"Azure OpenAI call failed: {exc}") from exc

        return to_str_content(completion.choices[0].message)

    # ------------------ Fallback: raw HTTP (OpenAI-compatible / generic HTTP) ------------------
    try:
        request_url = ensure_chat_completions_url(request_url)
    except ValueError as exc:
        raise RuntimeError(str(exc)) from exc

    api_version = str(remote_cfg.get("apiVersion") or "").strip()
    request_url = append_query_params(
        request_url,
        {
            "provider": provider_hint if provider_type == "huggingface" else None,
            "api-version": api_version or None,
        },
    )

    headers = build_http_headers(remote_cfg)
    if provider_type == "huggingface" and provider_hint:
        headers.setdefault("X-Inference-Provider", provider_hint)

    payload: Dict[str, Any] = {"model": model, "messages": messages}
    temperature = defaults.get("temperature")
    if isinstance(temperature, (int, float)):
        payload["temperature"] = float(temperature)
    max_tokens = defaults.get("maxOutputTokens")
    if isinstance(max_tokens, (int, float)) and max_tokens > 0:
        payload["max_tokens"] = int(max_tokens)
    payload["stream"] = False
    stop_sequences = defaults.get("stopSequences")
    if isinstance(stop_sequences, list) and stop_sequences:
        payload["stop"] = stop_sequences
    seed = defaults.get("seed")
    if isinstance(seed, (int, float)):
        payload["seed"] = int(seed)
    top_p = defaults.get("topP")
    if isinstance(top_p, (int, float)):
        payload["top_p"] = float(top_p)
    top_k = defaults.get("topK")
    if isinstance(top_k, (int, float)):
        payload["top_k"] = int(top_k)
    repetition_penalty = defaults.get("repetitionPenalty")
    if isinstance(repetition_penalty, (int, float)):
        payload["repetition_penalty"] = float(repetition_penalty)
    if defaults.get("jsonMode"):
        payload["response_format"] = {"type": "json_object"}
        schema_raw = defaults.get("jsonSchema")
        if isinstance(schema_raw, str) and schema_raw.strip():
            try:
                payload["response_format"]["schema"] = json.loads(schema_raw)
            except Exception:
                pass

    timeout_ms = remote_cfg.get("requestTimeoutMs")
    timeout_s = max(1.0, float(timeout_ms) / 1000.0) if isinstance(timeout_ms, (int, float)) else 30.0

    data = json.dumps(payload).encode("utf-8")
    req = urllib_request.Request(request_url, data=data, headers=headers, method="POST")

    try:
        with urllib_request.urlopen(req, timeout=timeout_s) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
    except urllib_error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="ignore")
        except Exception:
            detail = str(exc)
        raise RuntimeError(f"HTTP {exc.code}: {detail[:200]}") from exc
    except Exception as exc:
        raise RuntimeError(f"Request failed: {exc}") from exc

    try:
        parsed = json.loads(raw)
    except Exception:
        return raw

    if isinstance(parsed, dict) and parsed.get("error"):
        err = parsed.get("error")
        if isinstance(err, dict):
            message = err.get("message") or err.get("detail") or str(err)
        else:
            message = str(err)
        raise RuntimeError(f"Remote error: {message}")

    mapping = remote_cfg.get("parameterMapping") if isinstance(remote_cfg.get("parameterMapping"), dict) else {}
    text_path = mapping.get("responseTextPath") or "choices[0].message.content"
    message = extract_json_path(parsed, text_path)
    if message is None:
        return raw if isinstance(raw, str) else json.dumps(parsed)
    return to_str_content(message)

# --------------------------
# LLM output helpers
# --------------------------
def to_str_content(msg: Any) -> str:
    if msg is None:
        return ""
    content = getattr(msg, "content", None)
    if content is None and isinstance(msg, dict):
        content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for ch in content:
            if isinstance(ch, dict):
                if ch.get("type") == "text":
                    parts.append(ch.get("text", ""))
                elif "text" in ch:
                    parts.append(str(ch["text"]))
            else:
                parts.append(str(ch))
        return "".join(parts)
    return str(content) if content is not None else str(msg)

# --------------------------
# Universal KV parser
# --------------------------
CODE_FENCE_RE = re.compile(r"^```(?:json|JSON)?\s*|\s*```$", re.S)
SMART_QUOTES_RE = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'"})

def _preclean(text: str) -> str:
    t = text.strip()
    t = CODE_FENCE_RE.sub("", t)
    t = t.replace("\u00A0", " ")
    t = t.translate(SMART_QUOTES_RE)
    # Strip <think> blocks if any provider includes them
    t = re.sub(r"<think>.*?</think>", "", t, flags=re.S|re.I)
    return t.strip()

def _find_object_span(t: str) -> Optional[Tuple[int,int]]:
    s = t.find("{")
    e = t.rfind("}")
    if s != -1 and e != -1 and e > s:
        return s, e+1
    return None

def try_json_load(text: str) -> Optional[dict]:
    # Be tolerant: sometimes upstream hands non-strings
    if not isinstance(text, str):
        text = "" if text is None else str(text)

    t = _preclean(text)
    span = _find_object_span(t)
    if span:
        s, e = span
        # s,e are already proper slice bounds (end is exclusive)
        frag = t[s:e]
        try:
            return json.loads(frag)
        except Exception:
            pass

    # fallback: attempt to parse the whole thing
    try:
        return json.loads(t)
    except Exception:
        return None


# Regex patterns for JSON-ish pairs
PAIR_STR_STR = re.compile(r'''
    ["']\s*([^"']+?)\s*["']\s*:\s*["'](.*?)["']\s*(?=,|\n|\r|})
''', re.S|re.X)

PAIR_STR_BARE = re.compile(r'''
    ["']\s*([^"']+?)\s*["']\s*:\s*
    (?:
        -?\d+(?:\.\d+)?         # number
        |
        [A-Za-z0-9_./:-]+       # token-ish date/time/ID
    )
''', re.X)

PAIR_BARE_STR = re.compile(r'''
    (?<!["'])                  # not preceded by a quote
    \b([A-Za-z0-9 _./#-]+?)\b
    \s*:\s*
    ["'](.*?)["']\s*(?=,|\n|\r|})
''', re.S|re.X)

PAIR_BARE_BARE = re.compile(r'''
    (?<!["'])
    \b([A-Za-z0-9 _./#-]+?)\b
    \s*:\s*
    ([^,\n\r}]+)
''', re.X)

def _trim(v: str) -> str:
    return re.sub(r"\s+", " ", v.strip())

DATE_RE = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?\b")

def _pad2(n: str) -> str:
    try: return f"{int(n):02d}"
    except Exception: return n

def maybe_zero_pad_dates(val: str, normalize_dates: bool) -> str:
    if not normalize_dates:
        return _trim(val)
    def repl(m: re.Match) -> str:
        mm, dd, yyyy = _pad2(m.group(1)), _pad2(m.group(2)), m.group(3)
        if m.group(4) and m.group(5):
            hh, mi = _pad2(m.group(4)), _pad2(m.group(5))
            return f"{mm}/{dd}/{yyyy} {hh}:{mi}"
        return f"{mm}/{dd}/{yyyy}"
    return DATE_RE.sub(repl, _trim(val))

def _coerce_kv_dict(value: Any, normalize_dates: bool) -> Dict[str, str]:
    out = OrderedDict()

    def assign(k: Any, v: Any):
        if k is None:
            return
        key = _trim(str(k))
        if not key:
            return
        val = "" if v is None else str(v)
        out[key] = maybe_zero_pad_dates(val, normalize_dates)

    if isinstance(value, dict):
        for k, v in value.items():
            assign(k, v)
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                for k, v in item.items():
                    assign(k, v)
            elif isinstance(item, (list, tuple)) and len(item) == 2:
                k, v = item
                assign(k, v)

    return dict(out)


def _normalize_structured_payload(obj: Dict[str, Any], normalize_dates: bool) -> Dict[str, Dict[str, str]]:
    lowered = {str(k).lower(): k for k in obj.keys()}
    all_key = lowered.get("all_key_values")
    selected_key = lowered.get("selected_key_values")

    all_dict = _coerce_kv_dict(obj.get(all_key), normalize_dates) if all_key else {}
    selected_dict = _coerce_kv_dict(obj.get(selected_key), normalize_dates) if selected_key else {}

    if not all_dict:
        all_dict = _coerce_kv_dict(obj, normalize_dates)

    return {
        "all_key_values": all_dict,
        "selected_key_values": selected_dict,
    }


def parse_universal_kv(llm_raw: str, normalize_dates: bool=True) -> Dict[str, Dict[str, str]]:
    """
    - Try strict JSON
    - Else, regex-extract pairs from the first object-like region or entire text
    - Preserve insertion order; last wins on duplicate keys
    """
    j = try_json_load(llm_raw)
    if isinstance(j, dict):
        return _normalize_structured_payload(j, normalize_dates)
    if isinstance(j, list):
        for item in j:
            if isinstance(item, dict):
                lowered = {str(k).lower(): k for k in item.keys()}
                if "all_key_values" in lowered or "selected_key_values" in lowered:
                    return _normalize_structured_payload(item, normalize_dates)
        # Merge list of dicts or [key,value] pairs
        out = OrderedDict()
        for item in j:
            if isinstance(item, dict):
                for k, v in item.items():
                    out[_trim(str(k))] = maybe_zero_pad_dates(_trim(str(v)), normalize_dates)
            elif isinstance(item, (list, tuple)) and len(item) == 2:
                k, v = item
                out[_trim(str(k))] = maybe_zero_pad_dates(_trim(str(v)), normalize_dates)
        if out:
            return {
                "all_key_values": dict(out),
                "selected_key_values": {},
            }

    t = _preclean(llm_raw)
    region = t
    span = _find_object_span(t)
    if span:
        region = t[span[0]:span[1]]

    out = OrderedDict()

    # 1) "key": "value"
    for m in PAIR_STR_STR.finditer(region):
        k, v = m.group(1), m.group(2)
        out[_trim(k)] = maybe_zero_pad_dates(v, normalize_dates)

    # 2) "key": bare
    for m in PAIR_STR_BARE.finditer(region):
        k = m.group(1)
        mm = re.search(r':\s*([^\s,}\n\r]+)', m.group(0))
        v = mm.group(1) if mm else ""
        out[_trim(k)] = maybe_zero_pad_dates(v, normalize_dates)

    # 3) bare key: "value"
    for m in PAIR_BARE_STR.finditer(region):
        k, v = m.group(1), m.group(2)
        out[_trim(k)] = maybe_zero_pad_dates(v, normalize_dates)

    # 4) bare key: bare value
    for m in PAIR_BARE_BARE.finditer(region):
        k, v = m.group(1), m.group(2)
        v = re.sub(r"[}\]]\s*$", "", v).strip()
        out[_trim(k)] = maybe_zero_pad_dates(v, normalize_dates)

    return {
        "all_key_values": dict(out),
        "selected_key_values": {},
    }

def write_json_array(recs: List[dict], path: str):
    safe_mkdir(Path(path).parent.as_posix())
    with open(path, "w", encoding="utf-8") as f:
        json.dump(recs, f, ensure_ascii=False, indent=2)

# --------------------------
# Pipeline
# --------------------------
def process_one(
    vlm_call: Callable[[str, Optional[str]], str],
    image_path: str,
    normalize_dates: bool,
    ocr_hint: Optional[str] = None,
) -> Dict[str, Any]:
    raw = vlm_call(image_path, ocr_hint)
    parsed = parse_universal_kv(raw, normalize_dates=normalize_dates)
    return {
        "image": Path(image_path).name,
        "llm_raw": raw,
        "llm_parsed": parsed,
    }

def process_folder(
    vlm_call: Callable[[str, Optional[str]], str],
    data_dir: str,
    out_dir: str,
    normalize_dates: bool,
    ocr_hint: Optional[str] = None,
):
    structured_json = str(Path(out_dir)/"structured.json")
    structured: List[dict] = []

    paths = sorted([p for p in Path(data_dir).rglob("*") if p.suffix.lower() in IMAGE_EXTS])
    if not paths:
        print(f"[warn] No images under {data_dir}")

    for p in paths:
        print(f"[proc] {p.name}")
        rec = process_one(
            vlm_call,
            str(p),
            normalize_dates=normalize_dates,
            ocr_hint=ocr_hint,
        )
        structured.append(rec)

    write_json_array(structured, structured_json)
    print(f"[done] Array JSON -> {structured_json}")

# --------------------------
# Main
# --------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", help="Single image path")
    ap.add_argument("--data_dir", help="Folder of images (recursive)")
    ap.add_argument("--out_dir", default="./output")
    ap.add_argument("--hf_token", default=None, help="HF token (else env HF_TOKEN)")
    ap.add_argument("--provider", default="", help="Inference provider id (HF router provider name)")
    ap.add_argument("--model", default=DEFAULT_MODEL, help="Model id or deployment (provider-specific)")
    ap.add_argument("--mode", choices=["remote", "local"], default=None, help="Force execution mode (defaults to VLM_MODE)")
    ap.add_argument("--no_normalize_dates", action="store_true", help="Disable date zero-padding normalization")
    args = ap.parse_args()

    remote_cfg = load_remote_config()
    remote_cfg = remote_cfg if isinstance(remote_cfg, dict) else {}

    # Accept a wider set of provider types
    provider_type = str(remote_cfg.get("providerType") or "").lower()
    allowed = {"openai-compatible", "huggingface", "generic-http", "openai", "azure-openai"}
    if provider_type not in allowed:
        provider_type = "huggingface"
    remote_cfg["providerType"] = provider_type

    token = args.hf_token or os.environ.get("HF_TOKEN")

    defaults = remote_cfg.get("defaults") if isinstance(remote_cfg.get("defaults"), dict) else {}
    ocr_hint: Optional[str] = None
    ocr_cfg = remote_cfg.get("ocr") if isinstance(remote_cfg.get("ocr"), dict) else None
    if isinstance(ocr_cfg, dict):
        hint_candidate = ocr_cfg.get("prefillTranscript") or ocr_cfg.get("ocrHint")
        if isinstance(hint_candidate, str) and hint_candidate.strip():
            ocr_hint = hint_candidate.strip()
    env_hint = os.environ.get("OCR_HINT_TEXT")
    if isinstance(env_hint, str) and env_hint.strip():
        ocr_hint = env_hint.strip()

    if remote_cfg:
        model_override = remote_cfg.get("modelId")
        if isinstance(model_override, str) and model_override.strip():
            args.model = model_override.strip()

        api_key = remote_cfg.get("apiKey")
        auth_scheme = str(remote_cfg.get("authScheme") or "").lower()
        header_name = str(remote_cfg.get("authHeaderName") or "authorization").lower()
        if isinstance(api_key, str) and api_key:
            if (
                provider_type == "huggingface"
                or auth_scheme == "bearer"
                or (auth_scheme == "api-key-header" and header_name == "authorization")
            ):
                token = api_key

        proxy_url = remote_cfg.get("proxyUrl")
        if isinstance(proxy_url, str) and proxy_url.strip():
            os.environ.setdefault("HTTPS_PROXY", proxy_url.strip())
            os.environ.setdefault("HTTP_PROXY", proxy_url.strip())

        timeout_override = remote_cfg.get("requestTimeoutMs")
        if isinstance(timeout_override, (int, float)) and timeout_override > 0:
            os.environ["HF_TIMEOUT"] = str(float(timeout_override) / 1000.0)

    system_prompt = defaults.get("systemPrompt") if isinstance(defaults.get("systemPrompt"), str) else None
    if isinstance(system_prompt, str):
        os.environ["OCR_SYSTEM_PROMPT"] = system_prompt

    env_system_prompt = os.environ.get("OCR_SYSTEM_PROMPT")
    if isinstance(env_system_prompt, str):
        system_prompt = env_system_prompt

    cli_mode = (args.mode or "").strip().lower()
    env_mode = (os.environ.get("VLM_MODE") or "").strip().lower()
    mode = "remote"
    if cli_mode in {"local", "remote"}:
        mode = cli_mode
    if env_mode in {"local", "remote"}:
        mode = env_mode

    if mode == "local":
        model_hint = (os.environ.get("OCR_LOCAL_MODEL_ID") or args.model or DEFAULT_MODEL).strip()
        local_model = model_hint or DEFAULT_MODEL
        dtype = os.environ.get("OCR_LOCAL_DTYPE") or "auto"
        device_map = os.environ.get("OCR_LOCAL_DEVICE_MAP") or "auto"
        attn_impl_env = os.environ.get("OCR_LOCAL_ATTN_IMPLEMENTATION") or os.environ.get("OCR_LOCAL_ATTN_IMPL")
        flash_flag = os.environ.get("OCR_LOCAL_FLASH_ATTENTION")
        if parse_bool(flash_flag, False) and not attn_impl_env:
            attn_impl_env = "flash_attention_2"
        max_tokens_env = os.environ.get("OCR_LOCAL_MAX_NEW_TOKENS")
        try:
            max_tokens = int(max_tokens_env) if max_tokens_env not in {None, ""} else DEFAULT_LOCAL_MAX_NEW_TOKENS
        except Exception:
            max_tokens = DEFAULT_LOCAL_MAX_NEW_TOKENS

        try:
            ensure_local_model_available(local_model)
        except RuntimeError as exc:
            sys.exit(f"[FATAL] {exc}")

        try:
            vlm_call = build_local_vlm_call(local_model, dtype, device_map, max_tokens, attn_impl_env, system_prompt)
        except RuntimeError as exc:
            sys.exit(f"[FATAL] {exc}")

        print(f"[info] Local VLM model: {local_model}")

        safe_mkdir(args.out_dir)
        normalize_dates = not args.no_normalize_dates

        if args.image:
            p = Path(args.image)
            if not p.exists():
                sys.exit(f"[FATAL] Image not found: {p}")
            print(f"[proc] {p.name}")
            rec = process_one(vlm_call, str(p), normalize_dates=normalize_dates, ocr_hint=ocr_hint)
            write_json_array([rec], str(Path(args.out_dir) / "structured.json"))
            print(json.dumps(rec, ensure_ascii=False, indent=2))
            return

        if args.data_dir:
            if not Path(args.data_dir).exists():
                sys.exit(f"[FATAL] Folder not found: {args.data_dir}")
            process_folder(vlm_call, args.data_dir, args.out_dir, normalize_dates, ocr_hint)
            return

        print("Provide --image or --data_dir")
        return

    # Provider-specific bootstrapping
    if provider_type == "huggingface":
        # IMPORTANT: Do NOT set HF_ENDPOINT/HF_HUB_ENDPOINT to the router.
        # The HF SDK needs the hub (https://huggingface.co) for metadata calls.
        request_base = ""  # not used by the HF SDK path

        hf_provider_raw = remote_cfg.get("hfProvider") if isinstance(remote_cfg.get("hfProvider"), str) else ""
        cli_provider = args.provider.strip() if isinstance(args.provider, str) else ""
        provider_hint = (hf_provider_raw or cli_provider).strip()
        if not provider_hint:
            sys.exit("[FATAL] Configure a Hugging Face provider (e.g. mistralai, hyperbolic) before scanning.")

        remote_cfg["hfProvider"] = provider_hint

        if not token:
            print("[warn] HF token missing; gated/provider models may fail.", file=sys.stderr)

        def vlm_call(image_path: str, ocr_txt: Optional[str]) -> str:
            messages = build_vlm_messages(image_path, ocr_txt, system_prompt)
            return call_http_vlm(remote_cfg, request_base, args.model, messages, defaults)

    elif provider_type in {"openai", "azure-openai"}:
        base_url = remote_cfg.get("baseUrl") or ""
        def vlm_call(image_path: str, ocr_txt: Optional[str]) -> str:
            messages = build_vlm_messages(image_path, ocr_txt, system_prompt)
            return call_http_vlm(remote_cfg, base_url, args.model, messages, defaults)

    else:
        # openai-compatible / generic-http
        base_url = remote_cfg.get("baseUrl")
        if not isinstance(base_url, str) or not base_url.strip():
            sys.exit("[FATAL] Base URL is required for remote HTTP providers")
        def vlm_call(image_path: str, ocr_txt: Optional[str]) -> str:
            messages = build_vlm_messages(image_path, ocr_txt, system_prompt)
            return call_http_vlm(remote_cfg, base_url, args.model, messages, defaults)

    safe_mkdir(args.out_dir)
    normalize_dates = not args.no_normalize_dates

    if args.image:
        p = Path(args.image)
        if not p.exists():
            sys.exit(f"[FATAL] Image not found: {p}")
        print(f"[proc] {p.name}")
        rec = process_one(vlm_call, str(p), normalize_dates=normalize_dates, ocr_hint=ocr_hint)
        write_json_array([rec], str(Path(args.out_dir) / "structured.json"))
        print(json.dumps(rec, ensure_ascii=False, indent=2))
        return

    if args.data_dir:
        if not Path(args.data_dir).exists():
            sys.exit(f"[FATAL] Folder not found: {args.data_dir}")
        process_folder(vlm_call, args.data_dir, args.out_dir, normalize_dates, ocr_hint)
        return

    print("Provide --image or --data_dir")

if __name__ == "__main__":
    main()
