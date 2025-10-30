#!/usr/bin/env python3
"""Utility runner for keeping a local VLM warm."""
from __future__ import annotations

import argparse
import base64
import json
import os
import signal
import sys
import tempfile
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn
from typing import Any, Dict, Optional, Tuple

try:
    import torch
    from transformers import AutoConfig, AutoProcessor
except Exception as exc:  # pragma: no cover - import guard
    print(
        json.dumps(
            {
                "event": "fatal",
                "error": f"Failed to import torch/transformers: {exc}",
            }
        ),
        file=sys.stderr,
    )
    raise

# Optional dependency: huggingface_hub provides a quick existence check.
try:  # pragma: no cover - optional import
    from huggingface_hub import snapshot_download
except Exception:  # pragma: no cover - optional import
    snapshot_download = None


# Clear legacy CUDA allocator tweaks that can prevent large models from loading
# on Windows installs when users experimented with PyTorch settings earlier.
os.environ.pop("PYTORCH_CUDA_ALLOC_CONF", None)


def _prefer_flash_attention() -> None:  # pragma: no cover - hardware dependent
    try:
        from torch.nn.attention import SDPBackend, sdpa_kernel

        sdpa_kernel(SDPBackend.FLASH_ATTENTION)
    except Exception:
        try:
            from torch.backends.cuda import sdp_kernel

            sdp_kernel(enable_flash=True, enable_math=False, enable_mem_efficient=False)
        except Exception:
            pass


_prefer_flash_attention()


KEEPALIVE_IMAGE_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mP8z8Dwn4EIwDiqAAG9AwfKdTxE4wAAAABJRU5ErkJggg=="
)


def log_event(event: str, **payload: Any) -> None:
    message: Dict[str, Any] = {"event": event, **payload}
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def ensure_keepalive_image(tmp_dir: Path) -> Path:
    tmp_dir.mkdir(parents=True, exist_ok=True)
    keepalive = tmp_dir / "keepalive.png"
    if not keepalive.exists():
        keepalive.write_bytes(base64.b64decode(KEEPALIVE_IMAGE_B64))
    return keepalive


def _call_with_optional_trust_remote_code(func, *args, **kwargs):
    """Invoke a Hugging Face loader, tolerating older signatures."""

    try:
        return func(*args, **kwargs)
    except TypeError as exc:
        if "trust_remote_code" in str(exc):
            kwargs.pop("trust_remote_code", None)
            return func(*args, **kwargs)
        raise


def verify_local_install(model_id: str) -> None:
    common_kwargs = {"local_files_only": True}
    optional_kwargs = {"trust_remote_code": True}
    if snapshot_download is not None:
        _call_with_optional_trust_remote_code(
            snapshot_download,
            model_id,
            **common_kwargs,
            **optional_kwargs,
        )
    else:  # Fallback: ensure config + processor exist locally.
        _call_with_optional_trust_remote_code(
            AutoConfig.from_pretrained,
            model_id,
            **common_kwargs,
            **optional_kwargs,
        )
        _call_with_optional_trust_remote_code(
            AutoProcessor.from_pretrained,
            model_id,
            **common_kwargs,
            **optional_kwargs,
        )


def resolve_device_map(device: Optional[str]) -> Dict[str, str]:
    if device is None:
        if torch.cuda.is_available():
            return {"": "cuda:0"}
        return {"": "cpu"}

    normalized = device.strip().lower()
    if normalized in {"cpu", "cuda"}:
        if normalized == "cuda" and ":" not in device:
            return {"": "cuda:0"}
        return {"": normalized}
    return {"": device}


def load_model(model_id: str, device: str | None, dtype: str | None):
    from transformers import Qwen3VLForConditionalGeneration

    # We explicitly operate on pre-downloaded weights. Avoid attempting to fetch
    # files from the network again so that startup is deterministic when the
    # cache is incomplete.
    load_kwargs: Dict[str, Any] = {
        "local_files_only": True,
        "trust_remote_code": True,
        "attn_implementation": "sdpa",
        "device_map": resolve_device_map(device),
    }

    chosen_dtype = dtype
    if chosen_dtype is None:
        if torch.cuda.is_available():
            chosen_dtype = "float16"
        else:
            chosen_dtype = "float32"

    if chosen_dtype == "float16":
        load_kwargs["torch_dtype"] = torch.float16
    elif chosen_dtype == "bfloat16":
        load_kwargs["torch_dtype"] = torch.bfloat16

    model = _call_with_optional_trust_remote_code(
        Qwen3VLForConditionalGeneration.from_pretrained,
        model_id,
        **load_kwargs,
    )
    processor = _call_with_optional_trust_remote_code(
        AutoProcessor.from_pretrained,
        model_id,
        local_files_only=True,
        trust_remote_code=True,
    )
    model.eval()
    return model, processor


def infer_device(model) -> torch.device:
    if hasattr(model, "device"):
        return model.device  # type: ignore[return-value]
    for param in model.parameters():
        return param.device
    return torch.device("cpu")


def build_messages(image_path: str, prompt: str, system_prompt: Optional[str] = None) -> list[dict[str, Any]]:
    contents = [
        {"type": "image", "image": image_path},
        {"type": "text", "text": prompt},
    ]
    messages: list[dict[str, Any]] = []
    if system_prompt:
        messages.append({"role": "system", "content": [{"type": "text", "text": system_prompt}]})
    messages.append({"role": "user", "content": contents})
    return messages


def warmup(model, processor, keepalive_path: Path, system_prompt: Optional[str] = None) -> None:
    prompt = "Warm up the vision-language model."
    messages = build_messages(str(keepalive_path), prompt, system_prompt=system_prompt)
    inputs = processor.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_dict=True,
        return_tensors="pt",
    )
    model_device = infer_device(model)
    inputs = {k: v.to(model_device, non_blocking=True) for k, v in inputs.items()}
    with torch.inference_mode():
        _ = model.generate(
            **inputs,
            max_new_tokens=4,
            do_sample=False,
            use_cache=True,
        )


def ensure_image_path(image: str) -> str:
    if image.startswith("http://") or image.startswith("https://"):
        raise ValueError("Remote image URLs are not supported in local mode.")
    path = Path(image)
    if not path.exists():
        raise FileNotFoundError(f"Image not found: {image}")
    return str(path)


def run_generation(
    model,
    processor,
    payload: Dict[str, Any],
) -> Tuple[str, Dict[str, Any]]:
    image = payload.get("image")
    prompt = payload.get("prompt")
    system_prompt = payload.get("system_prompt")
    extra_text = payload.get("extra_text")
    ocr_text = payload.get("ocr_text")

    if not isinstance(image, str) or not image.strip():
        raise ValueError("'image' path is required in request payload")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("'prompt' text is required in request payload")

    resolved_image = ensure_image_path(image.strip())
    messages = build_messages(resolved_image, prompt.strip(), system_prompt=system_prompt if isinstance(system_prompt, str) else None)

    if isinstance(extra_text, str) and extra_text.strip():
        messages[-1]["content"].append({"type": "text", "text": extra_text.strip()})
    if isinstance(ocr_text, str) and ocr_text.strip():
        messages[-1]["content"].append({"type": "text", "text": f"OCR_TEXT_BEGIN\n{ocr_text.strip()}\nOCR_TEXT_END"})

    inputs = processor.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_dict=True,
        return_tensors="pt",
    )

    model_device = infer_device(model)
    inputs = {k: v.to(model_device, non_blocking=True) for k, v in inputs.items()}

    gen_kwargs: Dict[str, Any] = {
        "max_new_tokens": int(payload.get("max_new_tokens") or 512),
        "use_cache": True,
    }

    sampling = bool(payload.get("sampling"))
    if sampling:
        gen_kwargs.update(
            do_sample=True,
            temperature=float(payload.get("temperature") or 0.8),
            top_p=float(payload.get("top_p") or 0.9),
            top_k=int(payload.get("top_k") or 50),
        )
    else:
        gen_kwargs.update(do_sample=False)

    if "repetition_penalty" in payload:
        try:
            gen_kwargs["repetition_penalty"] = float(payload["repetition_penalty"])
        except Exception:
            pass

    if "eos_token_id" not in gen_kwargs:
        gen_kwargs["eos_token_id"] = processor.tokenizer.eos_token_id
    if "pad_token_id" not in gen_kwargs:
        gen_kwargs["pad_token_id"] = processor.tokenizer.eos_token_id

    with torch.inference_mode():
        outputs = model.generate(**inputs, **gen_kwargs)

    trimmed = [o[len(i) :] for i, o in zip(inputs["input_ids"], outputs)]
    text = processor.batch_decode(trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False)[0]
    return text, gen_kwargs


def create_http_server(host: str, port: int, model, processor):
    class RequestHandler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:  # pragma: no cover - suppress noisy logs
            sys.stderr.write("[local_vlm_runner] " + (format % args) + "\n")

        def _send_json(self, payload: Dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # pragma: no cover - debug endpoint
            if self.path not in {"/", "/status"}:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            self._send_json({"ok": True, "status": "ready"})

        def do_POST(self):
            if self.path.rstrip("/") != "/generate":
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except Exception:
                self.send_error(HTTPStatus.LENGTH_REQUIRED)
                return

            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                payload = json.loads(raw.decode("utf-8"))
            except Exception as exc:
                self._send_json({"ok": False, "error": f"Invalid JSON payload: {exc}"}, HTTPStatus.BAD_REQUEST)
                return

            try:
                output, info = run_generation(model, processor, payload)
            except Exception as exc:  # pragma: no cover - runtime error path
                self._send_json({"ok": False, "error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)
                return

            self._send_json({"ok": True, "output": output, "info": info})

    class Server(ThreadingMixIn, HTTPServer):
        daemon_threads = True
        allow_reuse_address = True

    server = Server((host, port), RequestHandler)
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="Local VLM runner")
    parser.add_argument("--model", required=True, help="Model identifier")
    parser.add_argument("--check-only", action="store_true", help="Only verify local installation")
    parser.add_argument("--device", default=None, help="Preferred device mapping (cpu/cuda/GPU id)")
    parser.add_argument("--dtype", default=None, choices=["float16", "bfloat16"], help="Preferred dtype")
    parser.add_argument("--host", default=os.environ.get("LOCAL_VLM_HOST", "127.0.0.1"), help="HTTP host to bind")
    parser.add_argument("--port", type=int, default=int(os.environ.get("LOCAL_VLM_PORT", "8411")), help="HTTP port to bind")
    parser.add_argument("--system-prompt", default=os.environ.get("LOCAL_VLM_SYSTEM_PROMPT", ""), help="Optional system prompt for warmup")
    args = parser.parse_args()

    model_id = args.model.strip()
    if not model_id:
        raise SystemExit("Model id is required")

    try:
        verify_local_install(model_id)
    except Exception as exc:
        log_event(
            "missing",
            error=f"Model '{model_id}' is not available locally: {exc}",
        )
        raise SystemExit(2)

    if args.check_only:
        log_event("checked", message=f"Model '{model_id}' is available locally.")
        return

    log_event("loading", message=f"Loading {model_id}…")
    tmp_dir = Path(tempfile.gettempdir()) / "realtime_item_tracker"

    try:
        model, processor = load_model(model_id, args.device, args.dtype)
        keepalive_path = ensure_keepalive_image(tmp_dir)
        warmup(model, processor, keepalive_path, system_prompt=args.system_prompt or None)
    except Exception as exc:
        log_event("fatal", error=f"Failed to load {model_id}: {exc}")
        raise SystemExit(3)

    try:
        server = create_http_server(args.host, args.port, model, processor)
    except OSError as exc:
        log_event("fatal", error=f"Failed to bind HTTP server on {args.host}:{args.port}: {exc}")
        raise SystemExit(4)

    log_event(
        "ready",
        message=f"Local model '{model_id}' is ready.",
        host=args.host,
        port=args.port,
    )

    stop_event = threading.Event()

    def shutdown_handler(signum, _frame):
        log_event("shutdown", signal=signum)
        stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, shutdown_handler)

    try:
        server_thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.25})
        server_thread.daemon = True
        server_thread.start()
        while not stop_event.is_set():
            time.sleep(0.2)
    finally:
        try:
            server.shutdown()
            server.server_close()
        except Exception:
            pass
        log_event("stopped", message="Local runner exiting.")


if __name__ == "__main__":
    main()
