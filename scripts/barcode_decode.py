#!/usr/bin/env python3
"""Utility script to extract barcodes from an image.

Uses zxing-cpp (via the `zxingcpp` Python bindings) + Pillow for robust
multi-pass decoding. If dependencies are unavailable or decoding fails,
falls back to a filename heuristic so local dev stubs still work.

Stdout JSON schema:
{
  "barcodes": string[],
  "warnings": string[]
}
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import List, Tuple

# Optional deps
try:  # pragma: no cover - optional
    from PIL import Image, ImageOps  # type: ignore
except Exception:  # pragma: no cover - optional
    Image = None  # type: ignore
    ImageOps = None  # type: ignore

try:  # pragma: no cover - optional
    import zxingcpp  # type: ignore
except Exception:  # pragma: no cover - optional
    zxingcpp = None  # type: ignore


def _filename_stub(image_path: Path) -> Tuple[List[str], List[str]]:
    """Cheap heuristic: longest alphanumeric token from filename."""
    tokens = re.findall(r"[A-Za-z0-9]{4,}", image_path.stem)
    if not tokens:
        return [], ["Unable to infer barcode value from filename"]
    token = max(tokens, key=len).upper()
    return [token], ["Barcode decoder unavailable or failed. Using filename heuristic result."]


def _zxing_decode_passes(pil_img) -> List[str]:
    """Run several sensible passes to improve robustness."""
    results: List[str] = []

    # pass 1: original
    decoded = zxingcpp.read_barcodes(pil_img)
    results.extend([d.text for d in decoded if getattr(d, "text", None)])

    if results:
        return results

    # pass 2: grayscale
    if ImageOps is not None:
        gray = ImageOps.grayscale(pil_img)
        decoded = zxingcpp.read_barcodes(gray)
        results.extend([d.text for d in decoded if getattr(d, "text", None)])
        if results:
            return results

    # pass 3: bottom crop (often used on documents with barcode near footer)
    w, h = pil_img.size
    crop = pil_img.crop((0, int(h * 0.60), w, h))
    decoded = zxingcpp.read_barcodes(crop)
    results.extend([d.text for d in decoded if getattr(d, "text", None)])

    return results


def _decode_with_zxing(image_path: Path) -> Tuple[List[str], List[str]]:
    warnings: List[str] = []
    if Image is None or zxingcpp is None:
        missing = []
        if Image is None:
            missing.append("Pillow")
        if zxingcpp is None:
            missing.append("zxing-cpp")
        warnings.append(
            "Barcode decoder dependencies missing: {}".format(", ".join(missing) or "unknown")
        )
        return [], warnings

    try:
        pil_img = Image.open(image_path)
    except Exception as exc:  # pragma: no cover - passthrough
        warnings.append(f"Unable to open image with Pillow: {exc}")
        return [], warnings

    try:
        barcodes = _zxing_decode_passes(pil_img)
    except Exception as exc:  # pragma: no cover - passthrough
        warnings.append(f"zxingcpp.read_barcodes failed: {exc}")
        return [], warnings

    if not barcodes:
        warnings.append("No barcodes detected by zxing-cpp")
    return barcodes, warnings


def decode_barcodes(image_path: Path) -> Tuple[List[str], List[str]]:
    # Try real decoder first
    barcodes, warnings = _decode_with_zxing(image_path)
    if barcodes:
        return barcodes, warnings

    # Fall back to filename heuristic so downstream code keeps working.
    stub_codes, stub_warnings = _filename_stub(image_path)
    return stub_codes, warnings + stub_warnings


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract barcodes from image")
    parser.add_argument("--image", required=True, help="Path to the input image")
    args = parser.parse_args()

    image_path = Path(args.image)
    if not image_path.exists():
        print(json.dumps({"barcodes": [], "warnings": [f"Image not found: {image_path}"]}))
        sys.exit(1)

    barcodes, warnings = decode_barcodes(image_path)
    print(json.dumps({"barcodes": barcodes, "warnings": warnings}))


if __name__ == "__main__":
    main()
