#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Local OCR + Qwen inference pipeline.

This script replaces the previous PaddleOCR + hosted Qwen pipeline with an
entirely local workflow based on ``Qwen/Qwen2-VL-2B-Instruct``.  The goal is to
mirror the original command-line interface so the Node.js wrapper can continue
invoking the script without changes while keeping all computation on the local
machine.

High level flow:
1. Load the requested Qwen vision-language model via ``transformers``.
2. Optionally downscale the input image to keep VRAM/CPU usage manageable.
3. Run a single-turn chat prompt that instructs the model to emit header
   key/value pairs as JSON.
4. Post-process the raw text into a dictionary using the same universal parser
   that the previous implementation used.
5. Write the structured artifacts expected by ``src/lib/ocrService.ts``.

The script is intentionally self-contained: there is no dependency on
``paddleocr`` or ``huggingface_hub`` APIs, and no remote calls are made.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import torch
from PIL import Image
from transformers import AutoModelForImageTextToText, AutoProcessor

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
DEFAULT_MODEL = "Qwen/Qwen2-VL-2B-Instruct"
DEFAULT_INSTRUCTION = (
    "You are given a document image. Extract all visible header key/value pairs "
    "and return a single flat JSON object. Do not include table line items."
)
DEFAULT_MAX_PIXELS = 384 * 384
DEFAULT_MAX_NEW_TOKENS = 600

_RESAMPLING = getattr(Image, "Resampling", Image)


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
            w.writerow({"image": r["image"], "json": json.dumps(r.get("json", {}), ensure_ascii=False)})


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
        frag = t[span[0]: span[1]]
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
        region = t[span[0]: span[1]]

    out = OrderedDict()
    for m in PAIR_STR_STR.finditer(region):
        k, v = m.group(1), m.group(2)
        out[_trim(k)] = maybe_zero_pad_dates(v, normalize_dates)
    for m in PAIR_STR_BARE.finditer(region):
        k = m.group(1)
        tail_match = re.search(r":\s*([^\s,}\n\r]+)", m.group(0))
        v = tail_match.group(1) if tail_match else ""
        out[_trim(k)] = maybe_zero_pad_dates(v, normalize_dates)
    for m in PAIR_BARE_STR.finditer(region):
        k, v = m.group(1), m.group(2)
        out[_trim(k)] = maybe_zero_pad_dates(v, normalize_dates)
    for m in PAIR_BARE_BARE.finditer(region):
        k, v = m.group(1), m.group(2)
        v = re.sub(r"[}\]]\s*$", "", v).strip()
        out[_trim(k)] = maybe_zero_pad_dates(v, normalize_dates)

    return dict(out)


# ---------------------------------------------------------------------------
# Local Qwen inference helpers
# ---------------------------------------------------------------------------
def resolve_device(arg: Optional[str]) -> torch.device:
    if arg:
        dev = torch.device(arg)
        if dev.type == "cuda" and not torch.cuda.is_available():
            raise SystemExit("CUDA requested but no GPU is available.")
        return dev
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def resolve_dtype(arg: Optional[str], device: torch.device) -> torch.dtype:
    if arg:
        mapping = {
            "float16": torch.float16,
            "float32": torch.float32,
            "bfloat16": torch.bfloat16,
            "auto": None,
        }
        if arg not in mapping:
            raise SystemExit(f"Unsupported dtype: {arg}")
        if mapping[arg] is not None:
            if device.type == "cpu" and mapping[arg] == torch.float16:
                raise SystemExit("float16 is not supported on CPU. Choose float32 or auto.")
            return mapping[arg]
    if device.type == "cuda":
        return torch.float16
    return torch.float32


_MODEL_CACHE: Dict[Tuple[str, str, str], Tuple[AutoProcessor, AutoModelForImageTextToText]] = {}


def load_model(model_id: str, device: torch.device, dtype: torch.dtype) -> Tuple[AutoProcessor, AutoModelForImageTextToText]:
    key = (model_id, device.type, str(dtype))
    if key not in _MODEL_CACHE:
        processor = AutoProcessor.from_pretrained(model_id)
        model = AutoModelForImageTextToText.from_pretrained(
            model_id,
            torch_dtype=dtype,
            attn_implementation="sdpa",
        ).to(device)
        model.eval()
        _MODEL_CACHE[key] = (processor, model)
    return _MODEL_CACHE[key]


def downscale_to_max_pixels(img: Image.Image, max_pixels: int = DEFAULT_MAX_PIXELS) -> Image.Image:
    w, h = img.size
    if w * h <= max_pixels:
        return img
    scale = (max_pixels / (w * h)) ** 0.5
    nw, nh = max(64, int(w * scale)), max(64, int(h * scale))
    return img.resize((nw, nh), _RESAMPLING.LANCZOS)


def run_qwen(
    image_path: str,
    instruction: str,
    model_id: str,
    device: torch.device,
    dtype: torch.dtype,
    max_pixels: int,
    max_new_tokens: int,
) -> str:
    processor, model = load_model(model_id, device, dtype)
    img = Image.open(image_path).convert("RGB")
    img = downscale_to_max_pixels(img, max_pixels=max_pixels)

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image"},
                {"type": "text", "text": instruction},
            ],
        }
    ]
    prompt = processor.apply_chat_template(messages, add_generation_prompt=True)
    inputs = processor(text=[prompt], images=[img], padding=True, return_tensors="pt").to(device)

    with torch.inference_mode():
        output = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            use_cache=False,
            eos_token_id=processor.tokenizer.eos_token_id,
            pad_token_id=processor.tokenizer.eos_token_id,
        )
    generated = output[:, inputs.input_ids.shape[1]:]
    text = processor.batch_decode(generated, skip_special_tokens=True, clean_up_tokenization_spaces=True)[0]
    return text.strip()


# ---------------------------------------------------------------------------
# Pipeline orchestration
# ---------------------------------------------------------------------------
def process_one(
    image_path: str,
    instruction: str,
    model_id: str,
    device: torch.device,
    dtype: torch.dtype,
    max_pixels: int,
    max_new_tokens: int,
    normalize_dates: bool,
) -> Dict[str, Any]:
    raw = run_qwen(
        image_path=image_path,
        instruction=instruction,
        model_id=model_id,
        device=device,
        dtype=dtype,
        max_pixels=max_pixels,
        max_new_tokens=max_new_tokens,
    )
    parsed = parse_universal_kv(raw, normalize_dates=normalize_dates)
    return {
        "image": Path(image_path).name,
        "llm_raw": raw,
        "llm_parsed": parsed,
    }


def process_folder(
    data_dir: str,
    instruction: str,
    model_id: str,
    device: torch.device,
    dtype: torch.dtype,
    max_pixels: int,
    max_new_tokens: int,
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
            instruction=instruction,
            model_id=model_id,
            device=device,
            dtype=dtype,
            max_pixels=max_pixels,
            max_new_tokens=max_new_tokens,
            normalize_dates=normalize_dates,
        )
        structured.append(rec)
        rows_csv.append({"image": rec["image"], "json": rec["llm_parsed"]})
        llm_recs.append({"image": rec["image"], "raw": rec["llm_raw"], "parsed": rec["llm_parsed"]})

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
    ap = argparse.ArgumentParser(description="Local OCR → Qwen KV extraction")
    ap.add_argument("--image", help="Single image path")
    ap.add_argument("--data_dir", help="Folder of images (recursive)")
    ap.add_argument("--out_dir", default="./output")
    ap.add_argument("--model", default=DEFAULT_MODEL, help="Hugging Face model id")
    ap.add_argument("--device", choices=["cpu", "cuda"], help="Override inference device")
    # Legacy compatibility flags that previously routed to remote services. We
    # still accept them so the Node wrapper can continue passing the same
    # arguments without the parser aborting, but they have no effect now that
    # inference is local only.
    ap.add_argument("--lang", default="en", help="(legacy) language hint; ignored")
    ap.add_argument("--provider", default="local", help="(legacy) provider name; ignored")
    ap.add_argument(
        "--dtype",
        choices=["auto", "float16", "float32", "bfloat16"],
        default="auto",
        help="Torch dtype used when loading the model",
    )
    ap.add_argument(
        "--instruction",
        default=DEFAULT_INSTRUCTION,
        help="Instruction prompt supplied to the model",
    )
    ap.add_argument("--max_pixels", type=int, default=DEFAULT_MAX_PIXELS, help="Max pixel area after downscaling")
    ap.add_argument("--max_new_tokens", type=int, default=DEFAULT_MAX_NEW_TOKENS, help="Generation cap")
    ap.add_argument("--no_normalize_dates", action="store_true", help="Disable MM/DD/YYYY zero padding")
    return ap


def main() -> None:
    ap = build_arg_parser()
    args = ap.parse_args()

    device = resolve_device(args.device)
    dtype = resolve_dtype(args.dtype, device)
    safe_mkdir(args.out_dir)
    normalize_dates = not args.no_normalize_dates

    if args.image:
        p = Path(args.image)
        if not p.exists():
            raise SystemExit(f"[FATAL] Image not found: {p}")
        print(f"[proc] {p.name}")
        rec = process_one(
            image_path=str(p),
            instruction=args.instruction,
            model_id=args.model,
            device=device,
            dtype=dtype,
            max_pixels=args.max_pixels,
            max_new_tokens=args.max_new_tokens,
            normalize_dates=normalize_dates,
        )
        write_json_array([rec], str(Path(args.out_dir) / "structured.json"))
        append_jsonl([rec], str(Path(args.out_dir) / "structured.jsonl"))
        write_csv([{"image": rec["image"], "json": rec["llm_parsed"]}], str(Path(args.out_dir) / "predictions.csv"))
        append_jsonl(
            [{"image": rec["image"], "raw": rec["llm_raw"], "parsed": rec["llm_parsed"]}],
            str(Path(args.out_dir) / "llm_preds.jsonl"),
        )
        print(json.dumps(rec, ensure_ascii=False, indent=2))
        return

    if args.data_dir:
        if not Path(args.data_dir).exists():
            raise SystemExit(f"[FATAL] Folder not found: {args.data_dir}")
        process_folder(
            data_dir=args.data_dir,
            instruction=args.instruction,
            model_id=args.model,
            device=device,
            dtype=dtype,
            max_pixels=args.max_pixels,
            max_new_tokens=args.max_new_tokens,
            out_dir=args.out_dir,
            normalize_dates=normalize_dates,
        )
        return

    raise SystemExit("Provide --image or --data_dir")


if __name__ == "__main__":
    main()
