#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PaddleOCR detection + Hugging Face Inference key/value extraction.

This script keeps the command-line interface expected by
``src/lib/ocrService.ts`` while swapping the heavy local Qwen dependency for a
lighter pipeline:

1. Detect raw text snippets with ``PaddleOCR``.
2. Summarise the snippets into structured logistics metadata using a
   Hugging Face Inference endpoint (chat or text-generation models).
3. Normalise the language model output into key/value JSON and persist the
   same ``structured.json`` artefact that the Node.js layer consumes.

If either dependency is unavailable the script exits with a non-zero code so
that the Node.js wrapper can fall back to its filename-based stub logic.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

try:  # PaddleOCR is optional at runtime
    from paddleocr import PaddleOCR  # type: ignore
except Exception as exc:  # pragma: no cover - surfaced at runtime
    PaddleOCR = None  # type: ignore
    _PADDLE_IMPORT_ERROR = exc
else:
    _PADDLE_IMPORT_ERROR = None

try:  # Hugging Face Inference client is optional at runtime
    from huggingface_hub import InferenceClient
except Exception as exc:  # pragma: no cover - surfaced at runtime
    InferenceClient = None  # type: ignore
    _HF_IMPORT_ERROR = exc
else:
    _HF_IMPORT_ERROR = None


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
DEFAULT_MODEL = "mistralai/Mistral-7B-Instruct-v0.2"
DEFAULT_SYSTEM_PROMPT = (
    "You are a logistics control tower assistant. Extract structured key/value "
    "data from OCR text. Always reply with a single flat JSON object."
)
DEFAULT_INSTRUCTION = (
    "Use the detected manifest text to fill these fields when possible: "
    "Destination, Item Name, Tracking/Order ID, Truck Number, Ship Date, "
    "Expected Departure Time, Origin Location. Include other key/value pairs "
    "that appear important."
)
DEFAULT_MAX_NEW_TOKENS = 512
DEFAULT_TEMPERATURE = 0.1
DEFAULT_MIN_CONFIDENCE = 0.3

_RESAMPLING = None  # Kept for backwards compatibility with previous versions


# ---------------------------------------------------------------------------
# Utility helpers reused from the previous implementation
# ---------------------------------------------------------------------------
def safe_mkdir(d: str) -> None:
    if d:
        Path(d).mkdir(parents=True, exist_ok=True)


def append_jsonl(recs: Iterable[dict], path: str) -> None:
    safe_mkdir(Path(path).parent.as_posix())
    with open(path, "a", encoding="utf-8") as f:
        for r in recs:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def write_json_array(recs: List[dict], path: str) -> None:
    safe_mkdir(Path(path).parent.as_posix())
    with open(path, "w", encoding="utf-8") as f:
        json.dump(recs, f, ensure_ascii=False, indent=2)


def write_csv(rows: List[Dict[str, Any]], out_csv: str) -> None:
    import csv

    safe_mkdir(Path(out_csv).parent.as_posix())
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["image", "json"])
        w.writeheader()
        for r in rows:
            json_payload = r.get("json", {})
            if not isinstance(json_payload, str):
                json_payload = json.dumps(json_payload, ensure_ascii=False)
            w.writerow({"image": r.get("image"), "json": json_payload})


# ---------------------------------------------------------------------------
# Universal KV parser (unchanged behaviour)
# ---------------------------------------------------------------------------
CODE_FENCE_RE = re.compile(r"^```(?:json|JSON)?\s*|\s*```$", re.S)
SMART_QUOTES_RE = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'"})
PAIR_STR_STR = re.compile(r"""
    ["']\s*([^"']+?)\s*["']\s*:\s*["'](.*?)["']\s*(?=,|\n|\r|})
""", re.S | re.X)
PAIR_STR_BARE = re.compile(r"""
    ["']\s*([^"']+?)\s*["']\s*:\s*
    (?:
        -?\d+(?:\.\d+)?
        |
        [A-Za-z0-9_./:-]+
    )
""", re.X)
PAIR_BARE_STR = re.compile(r"""
    (?<!["'])
    \b([A-Za-z0-9 _./#-]+?)\b
    \s*:\s*
    ["'](.*?)["']\s*(?=,|\n|\r|})
""", re.S | re.X)
PAIR_BARE_BARE = re.compile(r"""
    (?<!["'])
    \b([A-Za-z0-9 _./#-]+?)\b
    \s*:\s*
    ([^,\n\r}]+)
""", re.X)
DATE_RE = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?\b")


def _preclean(text: str) -> str:
    t = text.strip()
    t = CODE_FENCE_RE.sub("", t)
    t = t.replace("\u00A0", " ")
    t = t.translate(SMART_QUOTES_RE)
    t = re.sub(r"<think>.*?</think>", "", t, flags=re.S | re.I)
    return t.strip()


def _find_object_span(t: str) -> Optional[Tuple[int, int]]:
    s = t.find("{")
    e = t.rfind("}")
    if s != -1 and e != -1 and e > s:
        return s, e + 1
    return None


def try_json_load(text: str) -> Optional[dict]:
    t = _preclean(text)
    span = _find_object_span(t)
    if span:
        frag = t[span[0] : span[1]]
        try:
            return json.loads(frag)
        except Exception:
            pass
    try:
        return json.loads(t)
    except Exception:
        return None


def _trim(v: str) -> str:
    return re.sub(r"\s+", " ", v.strip())


def _pad2(n: str) -> str:
    try:
        return f"{int(n):02d}"
    except Exception:
        return n


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


def parse_universal_kv(llm_raw: str, normalize_dates: bool = True) -> Dict[str, str]:
    payload = try_json_load(llm_raw)
    if isinstance(payload, dict):
        out = OrderedDict()
        for k, v in payload.items():
            out[_trim(str(k))] = maybe_zero_pad_dates(_trim(str(v)), normalize_dates)
        return dict(out)
    if isinstance(payload, list):
        out = OrderedDict()
        for item in payload:
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
        region = t[span[0] : span[1]]

    out = OrderedDict()
    for m in PAIR_STR_STR.finditer(region):
        k, v = m.group(1), m.group(2)
        out[_trim(k)] = maybe_zero_pad_dates(v, normalize_dates)
    for m in PAIR_STR_BARE.finditer(region):
        k = m.group(1)
        tail_match = re.search(r":\s*([^\s,}\n\r]+)", m.group(0))
        if tail_match:
            out[_trim(k)] = maybe_zero_pad_dates(tail_match.group(1), normalize_dates)
    for m in PAIR_BARE_STR.finditer(region):
        k, v = m.group(1), m.group(2)
        out[_trim(k)] = maybe_zero_pad_dates(v, normalize_dates)
    for m in PAIR_BARE_BARE.finditer(region):
        k, v = m.group(1), m.group(2)
        out[_trim(k)] = maybe_zero_pad_dates(v, normalize_dates)

    return dict(out)


def fallback_pairs_from_lines(lines: Sequence[str]) -> Dict[str, str]:
    pairs: Dict[str, str] = {}
    for line in lines:
        if ":" in line:
            k, v = line.split(":", 1)
            key = k.strip()
            val = v.strip()
            if key and val and key not in pairs:
                pairs[key] = val
    return pairs


# ---------------------------------------------------------------------------
# PaddleOCR + Hugging Face inference helpers
# ---------------------------------------------------------------------------
_HF_CLIENTS: Dict[Tuple[str, Optional[str]], InferenceClient] = {}
_PADDLE_CLIENTS: Dict[Tuple[str, bool], PaddleOCR] = {}


def env_flag(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def load_paddle(lang: str, use_gpu: bool) -> PaddleOCR:
    if PaddleOCR is None:  # pragma: no cover - dependency missing at runtime
        raise SystemExit(
            "PaddleOCR is required but could not be imported: "
            f"{_PADDLE_IMPORT_ERROR!r}"
        )
    key = (lang, use_gpu)
    if key not in _PADDLE_CLIENTS:
        _PADDLE_CLIENTS[key] = PaddleOCR(
            lang=lang,
            use_angle_cls=True,
            use_gpu=use_gpu,
            show_log=False,
        )
    return _PADDLE_CLIENTS[key]


def load_hf_client(model: str, endpoint: Optional[str], token: Optional[str]) -> InferenceClient:
    if InferenceClient is None:  # pragma: no cover - dependency missing at runtime
        raise SystemExit(
            "huggingface_hub.InferenceClient is required but could not be imported: "
            f"{_HF_IMPORT_ERROR!r}"
        )
    key = (model if endpoint is None else endpoint, endpoint)
    if key not in _HF_CLIENTS:
        _HF_CLIENTS[key] = InferenceClient(
            model=None if endpoint else model,
            base_url=endpoint,
            token=token,
            timeout=120,
        )
    return _HF_CLIENTS[key]


def extract_text_lines(image_path: str, ocr: PaddleOCR, min_confidence: float) -> List[str]:
    lines: List[str] = []
    result = ocr.ocr(image_path, cls=True)
    for block in result or []:
        for entry in block or []:
            try:
                text, score = entry[1][0], float(entry[1][1])
            except Exception:
                continue
            if score < min_confidence:
                continue
            cleaned = text.strip()
            if cleaned:
                lines.append(cleaned)
    return lines


def build_prompt(instruction: str, detected_lines: Sequence[str]) -> str:
    bullet_list = "\n".join(f"- {line}" for line in detected_lines)
    return f"{instruction.strip()}\n\nDetected text:\n{bullet_list}"


def call_hf(
    model: str,
    endpoint: Optional[str],
    token: Optional[str],
    system_prompt: str,
    instruction: str,
    lines: Sequence[str],
    max_new_tokens: int,
    temperature: float,
) -> str:
    if not lines:
        return ""
    client = load_hf_client(model=model, endpoint=endpoint, token=token)
    prompt = build_prompt(instruction, lines)

    try:
        response = client.chat_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            max_tokens=max_new_tokens,
            temperature=temperature,
        )
        if response.choices:
            content = response.choices[0].message.get("content", "")
            if isinstance(content, list):
                text_parts = [part.get("text", "") for part in content if isinstance(part, dict)]
                return "".join(text_parts).strip()
            return str(content).strip()
    except Exception as err:  # pragma: no cover - network/runtime errors
        print(f"[warn] chat_completion failed: {err}", file=sys.stderr)

    # Fallback to plain text generation if chat-completions are unsupported.
    try:
        text = client.text_generation(
            f"{system_prompt}\n\n{prompt}\n\nJSON:",
            max_new_tokens=max_new_tokens,
            temperature=temperature,
            stream=False,
        )
        if isinstance(text, str):
            return text.strip()
    except Exception as err:  # pragma: no cover - network/runtime errors
        print(f"[warn] text_generation failed: {err}", file=sys.stderr)

    return ""


def process_one(
    image_path: str,
    paddle: PaddleOCR,
    min_confidence: float,
    model: str,
    endpoint: Optional[str],
    token: Optional[str],
    system_prompt: str,
    instruction: str,
    max_new_tokens: int,
    temperature: float,
    normalize_dates: bool,
) -> Dict[str, Any]:
    detected_lines = extract_text_lines(image_path, paddle, min_confidence=min_confidence)
    llm_raw = call_hf(
        model=model,
        endpoint=endpoint,
        token=token,
        system_prompt=system_prompt,
        instruction=instruction,
        lines=detected_lines,
        max_new_tokens=max_new_tokens,
        temperature=temperature,
    )
    if not llm_raw:
        llm_raw = "\n".join(detected_lines)

    parsed = parse_universal_kv(llm_raw, normalize_dates=normalize_dates)
    if not parsed and detected_lines:
        parsed = fallback_pairs_from_lines(detected_lines)

    return {
        "image": Path(image_path).name,
        "ocr_text": detected_lines,
        "llm_raw": llm_raw,
        "llm_parsed": parsed,
    }


def process_folder(
    data_dir: str,
    paddle: PaddleOCR,
    min_confidence: float,
    model: str,
    endpoint: Optional[str],
    token: Optional[str],
    system_prompt: str,
    instruction: str,
    max_new_tokens: int,
    temperature: float,
    out_dir: str,
    normalize_dates: bool,
) -> None:
    out_csv = str(Path(out_dir) / "predictions.csv")
    llm_jsonl = str(Path(out_dir) / "llm_preds.jsonl")
    structured_json = str(Path(out_dir) / "structured.json")
    structured_jsonl = str(Path(out_dir) / "structured.jsonl")

    rows_csv: List[Dict[str, Any]] = []
    llm_recs: List[dict] = []
    structured: List[dict] = []

    paths = sorted(p for p in Path(data_dir).rglob("*") if p.suffix.lower() in IMAGE_EXTS)
    if not paths:
        print(f"[warn] No images under {data_dir}")

    for p in paths:
        print(f"[proc] {p.name}")
        rec = process_one(
            image_path=str(p),
            paddle=paddle,
            min_confidence=min_confidence,
            model=model,
            endpoint=endpoint,
            token=token,
            system_prompt=system_prompt,
            instruction=instruction,
            max_new_tokens=max_new_tokens,
            temperature=temperature,
            normalize_dates=normalize_dates,
        )
        structured.append(rec)
        rows_csv.append({"image": rec["image"], "json": rec.get("llm_parsed", {})})
        llm_recs.append({"image": rec["image"], "raw": rec.get("llm_raw"), "parsed": rec.get("llm_parsed")})

    write_csv(rows_csv, out_csv)
    append_jsonl(llm_recs, llm_jsonl)
    write_json_array(structured, structured_json)
    append_jsonl(structured, structured_jsonl)

    print(f"[done] Array JSON -> {structured_json}")
    print(f"[done] JSONL -> {structured_jsonl}")
    print(f"[done] CSV -> {out_csv}")
    print(f"[done] LLM preds -> {llm_jsonl}")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
def build_arg_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="PaddleOCR + Hugging Face inference pipeline")
    ap.add_argument("--image", help="Single image path")
    ap.add_argument("--data_dir", help="Folder of images (recursive)")
    ap.add_argument("--out_dir", default="./output")
    ap.add_argument("--model", default=DEFAULT_MODEL, help="Hugging Face model id")
    ap.add_argument("--system_prompt", default=DEFAULT_SYSTEM_PROMPT)
    ap.add_argument("--instruction", default=DEFAULT_INSTRUCTION)
    ap.add_argument("--hf_token", help="Hugging Face token (falls back to env)")
    ap.add_argument("--hf_endpoint", help="Custom Inference Endpoints URL")
    ap.add_argument("--temperature", type=float, default=DEFAULT_TEMPERATURE)
    ap.add_argument("--max_new_tokens", type=int, default=DEFAULT_MAX_NEW_TOKENS)
    ap.add_argument("--paddle_lang", default="en", help="PaddleOCR language code")
    ap.add_argument("--min_confidence", type=float, default=DEFAULT_MIN_CONFIDENCE)
    ap.add_argument("--use_gpu", action="store_true", help="Force PaddleOCR GPU usage")
    ap.add_argument("--no_normalize_dates", action="store_true", help="Disable MM/DD/YYYY zero padding")
    return ap


def resolve_token(cli_token: Optional[str]) -> Optional[str]:
    if cli_token:
        return cli_token
    for key in ("OCR_HF_TOKEN", "HF_TOKEN", "HUGGINGFACEHUB_API_TOKEN"):
        val = os.getenv(key)
        if val:
            return val
    return None


def resolve_endpoint(cli_endpoint: Optional[str]) -> Optional[str]:
    if cli_endpoint:
        return cli_endpoint
    return os.getenv("OCR_HF_ENDPOINT") or None


def resolve_language(cli_lang: str) -> str:
    return os.getenv("OCR_PADDLE_LANG", cli_lang)


def resolve_min_confidence(cli_conf: float) -> float:
    env_val = os.getenv("OCR_MIN_CONFIDENCE")
    if not env_val:
        return cli_conf
    try:
        return float(env_val)
    except ValueError:
        return cli_conf


def main() -> None:
    ap = build_arg_parser()
    args = ap.parse_args()

    token = resolve_token(args.hf_token)
    endpoint = resolve_endpoint(args.hf_endpoint)
    lang = resolve_language(args.paddle_lang)
    min_confidence = resolve_min_confidence(args.min_confidence)
    use_gpu = args.use_gpu or env_flag("OCR_PADDLE_USE_GPU")
    normalize_dates = not args.no_normalize_dates

    if not args.image and not args.data_dir:
        raise SystemExit("Provide --image or --data_dir")

    paddle = load_paddle(lang=lang, use_gpu=use_gpu)
    safe_mkdir(args.out_dir)

    if args.image:
        p = Path(args.image)
        if not p.exists():
            raise SystemExit(f"[FATAL] Image not found: {p}")
        print(f"[proc] {p.name}")
        rec = process_one(
            image_path=str(p),
            paddle=paddle,
            min_confidence=min_confidence,
            model=args.model,
            endpoint=endpoint,
            token=token,
            system_prompt=args.system_prompt,
            instruction=args.instruction,
            max_new_tokens=args.max_new_tokens,
            temperature=args.temperature,
            normalize_dates=normalize_dates,
        )
        write_json_array([rec], str(Path(args.out_dir) / "structured.json"))
        append_jsonl([rec], str(Path(args.out_dir) / "structured.jsonl"))
        write_csv(
            [{"image": rec["image"], "json": rec.get("llm_parsed", {})}],
            str(Path(args.out_dir) / "predictions.csv"),
        )
        append_jsonl(
            [{"image": rec["image"], "raw": rec.get("llm_raw"), "parsed": rec.get("llm_parsed")}],
            str(Path(args.out_dir) / "llm_preds.jsonl"),
        )
        print(json.dumps(rec, ensure_ascii=False, indent=2))
        return

    if args.data_dir:
        if not Path(args.data_dir).exists():
            raise SystemExit(f"[FATAL] Folder not found: {args.data_dir}")
        process_folder(
            data_dir=args.data_dir,
            paddle=paddle,
            min_confidence=min_confidence,
            model=args.model,
            endpoint=endpoint,
            token=token,
            system_prompt=args.system_prompt,
            instruction=args.instruction,
            max_new_tokens=args.max_new_tokens,
            temperature=args.temperature,
            out_dir=args.out_dir,
            normalize_dates=normalize_dates,
        )
        return


if __name__ == "__main__":
    main()
