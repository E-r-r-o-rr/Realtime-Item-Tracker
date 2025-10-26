#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
This file contains the OCR pipeline used to extract key/value pairs from
documents. The code is copied from the user-provided script and retained here
for completeness. It is not executed as part of the Node.js application by
default because its dependencies (paddleocr, Qwen2.5-VL, huggingface_hub) are
not installed in this environment. To enable real OCR extraction, install the
required Python dependencies and adjust the Node API to call this script.
"""

from __future__ import annotations

import os, re, sys, json, argparse, base64, mimetypes, statistics
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, TYPE_CHECKING, Union
from collections import OrderedDict
from urllib import request as urllib_request, error as urllib_error
from urllib.parse import quote as url_quote

if TYPE_CHECKING:
    from huggingface_hub import InferenceClient
    from paddleocr import PaddleOCR

try:
    from huggingface_hub import InferenceClient as HFInferenceClient
except Exception:
    HFInferenceClient = None
    print("[warn] huggingface_hub not installed; Hugging Face provider unavailable.", file=sys.stderr)
try:
    from paddleocr import PaddleOCR as PaddleOCRRuntime
except Exception:
    PaddleOCRRuntime = None
    print("[FATAL] Install paddleocr + paddlepaddle", file=sys.stderr)

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
DEFAULT_MODEL = "Qwen/Qwen2.5-VL-7B-Instruct"
HF_ROUTER_BASE = "https://router.huggingface.co/hf-inference"


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
    if not isinstance(value, str) or not value.strip():
        return HF_ROUTER_BASE

    trimmed = value.strip()
    deprecated_prefix = "https://api-inference.huggingface.co"
    if trimmed.startswith(deprecated_prefix):
        suffix = trimmed[len(deprecated_prefix) :].lstrip("/")
        base = HF_ROUTER_BASE.rstrip("/")
        return f"{base}/{suffix}" if suffix else HF_ROUTER_BASE

    return trimmed



def safe_mkdir(d: str):
    if d:
        Path(d).mkdir(parents=True, exist_ok=True)

def guess_mime(p: str) -> str:
    mime, _ = mimetypes.guess_type(p)
    return mime or "image/jpeg"

def encode_image_to_base64(image_path: str) -> str:
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")
    return f"data:{guess_mime(image_path)};base64,{b64}"

def parse_path_tokens(path: str) -> List[Union[str, int]]:
    tokens: List[Union[str, int]] = []
    buf = ""
    i = 0
    while i < len(path):
        ch = path[i]
        if ch == ".":
            if buf:
                tokens.append(buf)
                buf = ""
            i += 1
            continue
        if ch == "[":
            if buf:
                tokens.append(buf)
                buf = ""
            j = path.find("]", i)
            if j == -1:
                break
            idx_str = path[i + 1 : j].strip()
            if idx_str.isdigit():
                tokens.append(int(idx_str))
            i = j + 1
            continue
        buf += ch
        i += 1
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

def build_vlm_messages(image_path: str, ocr_txt: str, system_prompt: Optional[str] = None) -> List[Dict[str, Any]]:
    img_b64 = encode_image_to_base64(image_path)
    instruction = (
        "You are given a shipping/order IMAGE and its OCR transcript.\n"
        "Extract all visible header key/value pairs (ignore item rows). "
        "Return a single flat JSON object. Do not wrap in code fences."
    )
    user_content = [
        {"type": "text", "text": instruction},
        {"type": "image_url", "image_url": {"url": img_b64}},
        {"type": "text", "text": "OCR_TEXT_BEGIN\n" + ocr_txt + "\nOCR_TEXT_END"},
        {"type": "text", "text": "OUTPUT: JSON only."},
    ]
    messages: List[Dict[str, Any]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": user_content})
    return messages

def call_huggingface_vlm(
    client: "InferenceClient",
    model: str,
    messages: List[Dict[str, Any]],
    temperature: float,
    max_tokens: int,
) -> str:
    kwargs: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    if max_tokens > 0:
        kwargs["max_tokens"] = max_tokens
    resp = client.chat.completions.create(**kwargs)
    choice = resp.choices[0]
    msg = getattr(choice, "message", choice.get("message"))
    return to_str_content(msg)

def call_http_vlm(
    remote_cfg: Dict[str, Any],
    base_url: str,
    model: str,
    messages: List[Dict[str, Any]],
    defaults: Dict[str, Any],
) -> str:
    provider_type = str(remote_cfg.get("providerType") or "").lower()
    request_url = base_url.strip()
    if provider_type != "huggingface" and "huggingface.co" in request_url.lower():
        provider_type = "huggingface"
    if provider_type == "huggingface":
        request_url = normalize_hf_base_url(request_url)
        if "/v1/" not in request_url:
            request_url = request_url.rstrip("/") + "/v1/chat/completions"
        provider_hint = remote_cfg.get("hfProvider")
        if isinstance(provider_hint, str) and provider_hint.strip():
            clean_provider = provider_hint.strip()
            sep = "&" if "?" in request_url else "?"
            request_url = f"{request_url}{sep}provider={url_quote(clean_provider)}"

    api_version = str(remote_cfg.get("apiVersion") or "").strip()
    if api_version:
        separator = "&" if "?" in request_url else "?"
        request_url = f"{request_url}{separator}api-version={api_version}"

    headers = build_http_headers(remote_cfg)
    if provider_type == "huggingface":
        provider_hint = remote_cfg.get("hfProvider")
        if isinstance(provider_hint, str) and provider_hint.strip():
            headers.setdefault("X-Inference-Provider", provider_hint.strip())

    payload: Dict[str, Any] = {
        "model": model,
        "messages": messages,
    }

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
# OCR wrappers
# --------------------------
def _to_rect_from_box(box) -> Tuple[float,float,float,float,float,float,float,float]:
    if not box:
        return (0,0,0,0,0,0,0,0)
    # handle polygon or x1,y1,x2,y2
    if isinstance(box, (list, tuple)) and len(box) == 4 and all(isinstance(v, (int,float)) for v in box):
        x1, y1, x2, y2 = map(float, box)
    else:
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    return x1, y1, x2, y2, cx, cy, (x2 - x1), (y2 - y1)

def _parse_paddle_line(line) -> Tuple[List[List[float]], str]:
    box, text = None, None
    if isinstance(line, dict):
        text = line.get("text") or line.get("transcription") or line.get("label")
        if "points" in line and isinstance(line["points"], (list, tuple)) and len(line["points"]) >= 4:
            box = [[float(p[0]), float(p[1])] for p in line["points"][:4]]
        elif "bbox" in line and isinstance(line["bbox"], (list, tuple)) and len(line["bbox"]) >= 4:
            x1, y1, x2, y2 = line["bbox"][:4]
            box = [[x1,y1],[x2,y1],[x2,y2],[x1,y2]]
    if (box is None or text is None) and isinstance(line, (list, tuple)) and len(line) >= 2:
        mb, mp = line[0], line[1]
        if isinstance(mp, (list, tuple)) and mp and isinstance(mp[0], str):
            text = mp[0]
        elif isinstance(mp, str):
            text = mp
        if isinstance(mb, (list, tuple)):
            if len(mb) >= 4 and all(isinstance(p, (list, tuple)) and len(p) >= 2 for p in mb[:4]):
                box = [[float(mb[i][0]), float(mb[i][1])] for i in range(4)]
            elif len(mb) >= 8 and all(isinstance(v, (int,float)) for v in mb[:8]):
                mb = list(mb)
                box = [[mb[0],mb[1]],[mb[2],mb[3]],[mb[4],mb[5]],[mb[6],mb[7]]]
    if box is None:
        box = [[0,0],[0,0],[0,0],[0,0]]
    if text is None:
        text = ""
    return box, text

def _entries_from_paddle_page(page) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if hasattr(page, "to_dict"):
        try:
            d = page.to_dict()
            texts = d.get("rec_texts") or d.get("texts") or []
            boxes = d.get("rec_boxes") or d.get("boxes") or d.get("rec_polys") or d.get("dt_polys") or d.get("det_polys") or []
            for t, b in zip(texts, boxes):
                x1,y1,x2,y2,cx,cy,w,h = _to_rect_from_box(b)
                out.append({"text": str(t), "x1":x1,"y1":y1,"x2":x2,"y2":y2,"cx":cx,"cy":cy,"w":w,"h":h})
            return out
        except Exception:
            pass
    if isinstance(page, (list, tuple)):
        for line in page:
            box, txt = _parse_paddle_line(line)
            x1,y1,x2,y2,cx,cy,w,h = _to_rect_from_box(box)
            out.append({"text": str(txt), "x1":x1,"y1":y1,"x2":x2,"y2":y2,"cx":cx,"cy":cy,"w":w,"h":h})
    return out

def run_paddle_ocr(ocr: "PaddleOCR", image_path: str) -> Tuple[List[Dict[str, Any]], float]:
    try:
        raw = ocr.predict(str(image_path))
    except Exception:
        raw = ocr.ocr(str(image_path), cls=False)
    pages = raw if isinstance(raw, (list, tuple)) else [raw]
    entries, heights = [], []
    for pg in pages:
        e = _entries_from_paddle_page(pg)
        entries.extend(e); heights.extend([v["h"] for v in e])
    med_h = statistics.median(heights) if heights else 20.0
    return entries, med_h

def ocr_text(entries: List[Dict[str, Any]], max_chars=12000) -> str:
    ents = sorted(entries, key=lambda e: (e.get("cy", 0.0), e.get("cx", 0.0)))
    txt = "\n".join((e["text"].strip()) for e in ents if e["text"].strip())
    return (txt[:max_chars] + "\n...[TRUNCATED]") if len(txt) > max_chars else txt

# --------------------------
# LLM call
# --------------------------
def to_str_content(msg: Any) -> str:
    if msg is None: return ""
    content = getattr(msg, "content", None)
    if content is None and isinstance(msg, dict): content = msg.get("content")
    if isinstance(content, str): return content
    if isinstance(content, list):
        parts: List[str] = []
        for ch in content:
            if isinstance(ch, dict):
                if ch.get("type") == "text": parts.append(ch.get("text",""))
                elif "text" in ch: parts.append(str(ch["text"]))
            else:
                parts.append(str(ch))
        return "".join(parts)
    return str(content) if content is not None else str(msg)

# --------------------------
# Universal KV parser
# --------------------------
CODE_FENCE_RE = re.compile(r"^```(?:json|JSON)?\s*|\s*```$", re.S)
SMART_QUOTES_RE = str.maketrans({"“":'"',"”":'"',"‘":"'", "’":"'"})

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
    t = _preclean(text)
    span = _find_object_span(t)
    if span:
        frag = t[span[0]:span[1]]
        try:
            return json.loads(frag)
        except Exception:
            pass
    # fallback: raw text might already be valid JSON without extra chatter
    try:
        return json.loads(t)
    except Exception:
        return None

# Regex patterns for JSON-ish pairs
# 1) "key": "value"
PAIR_STR_STR = re.compile(r'''
    ["']\s*([^"']+?)\s*["']\s*:\s*["'](.*?)["']\s*(?=,|\n|\r|})
''', re.S|re.X)

# 2) "key": number/word/date without quotes
PAIR_STR_BARE = re.compile(r'''
    ["']\s*([^"']+?)\s*["']\s*:\s*
    (?:
        -?\d+(?:\.\d+)?         # number
        |
        [A-Za-z0-9_./:-]+       # token-ish date/time/ID
    )
''', re.X)

# 3) key: "value"  (unquoted key)
PAIR_BARE_STR = re.compile(r'''
    (?<!["'])                  # not preceded by a quote
    \b([A-Za-z0-9 _./#-]+?)\b
    \s*:\s*
    ["'](.*?)["']\s*(?=,|\n|\r|})
''', re.S|re.X)

# 4) key: value (both bare, terminate on , or } or newline)
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

def parse_universal_kv(llm_raw: str, normalize_dates: bool=True) -> Dict[str, str]:
    """
    - Try strict JSON
    - Else, regex-extract pairs from the first object-like region or entire text
    - Preserve insertion order; last wins on duplicate keys
    """
    j = try_json_load(llm_raw)
    if isinstance(j, dict):
        out = OrderedDict()
        for k, v in j.items():
            out[_trim(str(k))] = maybe_zero_pad_dates(_trim(str(v)), normalize_dates)
        return dict(out)
    if isinstance(j, list):
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
            return dict(out)

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
        # value is the whole match's tail after colon; recapture precisely
        tail = region[m.end():]  # not perfect; refine by re-searching from start
        # Better: get the exact matched value from the overall match
        # Re-run a small regex on the matched substring:
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
        # avoid capturing JSON block delimiters or trailing comments
        v = re.sub(r"[}\]]\s*$", "", v).strip()
        out[_trim(k)] = maybe_zero_pad_dates(v, normalize_dates)

    return dict(out)

def write_json_array(recs: List[dict], path: str):
    safe_mkdir(Path(path).parent.as_posix())
    with open(path, "w", encoding="utf-8") as f:
        json.dump(recs, f, ensure_ascii=False, indent=2)

# --------------------------
# Pipeline
# --------------------------
def process_one(
    vlm_call: Callable[[str, str], str],
    ocr: "PaddleOCR",
    image_path: str,
    normalize_dates: bool,
    ocr_char_limit: int,
) -> Dict[str, Any]:
    entries, _ = run_paddle_ocr(ocr, image_path)
    txt = ocr_text(entries, max_chars=ocr_char_limit)

    raw = vlm_call(image_path, txt)
    parsed = parse_universal_kv(raw, normalize_dates=normalize_dates)
    return {
        "image": Path(image_path).name,
        "llm_raw": raw,
        "llm_parsed": parsed
    }

def process_folder(
    vlm_call: Callable[[str, str], str],
    ocr: "PaddleOCR",
    data_dir: str,
    out_dir: str,
    normalize_dates: bool,
    ocr_char_limit: int,
):
    structured_json = str(Path(out_dir)/"structured.json")

    structured: List[dict] = []

    paths = sorted([p for p in Path(data_dir).rglob("*") if p.suffix.lower() in IMAGE_EXTS])
    if not paths:
        print(f"[warn] No images under {data_dir}")

    for p in paths:
        print(f"[proc] {p.name}")
        rec = process_one(vlm_call, ocr, str(p), normalize_dates=normalize_dates, ocr_char_limit=ocr_char_limit)
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
    ap.add_argument("--provider", default="", help="Inference provider id")
    ap.add_argument("--model", default=DEFAULT_MODEL, help="Model id on provider")
    ap.add_argument("--lang", default="en", help="PaddleOCR language")
    ap.add_argument("--no_normalize_dates", action="store_true", help="Disable date zero-padding normalization")
    args = ap.parse_args()

    if PaddleOCRRuntime is None:
        sys.exit(2)

    remote_cfg = load_remote_config()
    remote_cfg = remote_cfg if isinstance(remote_cfg, dict) else {}

    provider_type = str(remote_cfg.get("providerType") or "").lower()
    if provider_type not in {"openai-compatible", "huggingface", "generic-http"}:
        provider_type = "huggingface"
    remote_cfg["providerType"] = provider_type

    token = args.hf_token or os.environ.get("HF_TOKEN")

    defaults = remote_cfg.get("defaults") if isinstance(remote_cfg.get("defaults"), dict) else {}
    ocr_cfg = remote_cfg.get("ocr") if isinstance(remote_cfg.get("ocr"), dict) else {}
    try:
        ocr_char_limit = int(ocr_cfg.get("inputLimitChars") or 12000)
    except Exception:
        ocr_char_limit = 12000

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

    if provider_type == "huggingface":
        if HFInferenceClient is None:
            sys.exit("[FATAL] Install huggingface_hub to use the Hugging Face provider")
        base_url = normalize_hf_base_url(remote_cfg.get("baseUrl"))
        os.environ.setdefault("HF_ENDPOINT", base_url.rstrip("/"))
        remote_cfg["baseUrl"] = base_url
        hf_provider = remote_cfg.get("hfProvider") if isinstance(remote_cfg.get("hfProvider"), str) else ""
        provider_hint = hf_provider or args.provider or None
        if not token:
            print("[warn] HF token missing; gated/provider models may fail.", file=sys.stderr)
        client_kwargs: Dict[str, Any] = {}
        if base_url:
            client_kwargs["base_url"] = base_url
        if provider_hint:
            client_kwargs["provider"] = provider_hint
        if token:
            client_kwargs["api_key"] = token
        client = HFInferenceClient(**client_kwargs)
        temperature = float(defaults.get("temperature") or 0.0)
        max_tokens = int(defaults.get("maxOutputTokens") or 1024)

        def vlm_call(image_path: str, ocr_txt: str) -> str:
            messages = build_vlm_messages(image_path, ocr_txt, system_prompt)
            return call_huggingface_vlm(client, args.model, messages, temperature, max_tokens)

    else:
        base_url = remote_cfg.get("baseUrl")
        if not isinstance(base_url, str) or not base_url.strip():
            sys.exit("[FATAL] Base URL is required for remote HTTP providers")

        def vlm_call(image_path: str, ocr_txt: str) -> str:
            messages = build_vlm_messages(image_path, ocr_txt, system_prompt)
            return call_http_vlm(remote_cfg, base_url, args.model, messages, defaults)

    ocr = PaddleOCRRuntime(
        lang=args.lang,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False
    )

    safe_mkdir(args.out_dir)
    normalize_dates = not args.no_normalize_dates

    if args.image:
        p = Path(args.image)
        if not p.exists():
            sys.exit(f"[FATAL] Image not found: {p}")

        print(f"[proc] {p.name}")
        rec = process_one(
            vlm_call,
            ocr,
            str(p),
            normalize_dates=normalize_dates,
            ocr_char_limit=ocr_char_limit,
        )

        # write artifacts
        write_json_array([rec], str(Path(args.out_dir)/"structured.json"))

        print(json.dumps(rec, ensure_ascii=False, indent=2))
        return

    if args.data_dir:
        if not Path(args.data_dir).exists():
            sys.exit(f"[FATAL] Folder not found: {args.data_dir}")
        process_folder(
            vlm_call,
            ocr,
            args.data_dir,
            args.out_dir,
            normalize_dates,
            ocr_char_limit,
        )
        return

    print("Provide --image or --data_dir")

if __name__ == "__main__":
    main()
