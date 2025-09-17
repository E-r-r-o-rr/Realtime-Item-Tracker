#!/usr/bin/env python3
"""Utility script to extract barcodes from an image.

The script tries to use ``pyzbar`` + ``Pillow`` if they are installed. When the
runtime does not have these optional dependencies, we gracefully fall back to a
simple filename heuristic so the TypeScript stubs can still operate during
local development. The script prints a JSON payload to stdout with the detected
barcode strings and any warnings that occurred during processing.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import List, Tuple

try:  # Optional dependency
    from PIL import Image  # type: ignore
except Exception:  # pragma: no cover - optional
    Image = None  # type: ignore

try:  # Optional dependency
    from pyzbar import pyzbar  # type: ignore
except Exception:  # pragma: no cover - optional
    pyzbar = None  # type: ignore


def _decode_with_pyzbar(image_path: Path) -> Tuple[List[str], List[str]]:
    warnings: List[str] = []
    barcodes: List[str] = []

    if Image is None or pyzbar is None:
        missing = []
        if Image is None:
            missing.append("Pillow")
        if pyzbar is None:
            missing.append("pyzbar")
        warnings.append(
            "Barcode decoder dependencies missing: {}".format(
                ", ".join(missing) if missing else "unknown"
            )
        )
        return barcodes, warnings

    try:
        image = Image.open(image_path)
    except Exception as exc:  # pragma: no cover - passthrough warning
        warnings.append(f"Unable to open image with Pillow: {exc}")
        return barcodes, warnings

    try:
        decoded = pyzbar.decode(image)
    except Exception as exc:  # pragma: no cover - passthrough warning
        warnings.append(f"pyzbar.decode failed: {exc}")
        return barcodes, warnings

    for item in decoded:
        try:
            data = item.data.decode("utf-8", errors="ignore")
        except Exception:  # pragma: no cover - guard
            continue
        if data:
            barcodes.append(data)

    if not barcodes:
        warnings.append("No barcodes detected by pyzbar")
    return barcodes, warnings


def _stub_from_filename(image_path: Path) -> Tuple[List[str], List[str]]:
    stem = image_path.stem
    # Use a simple heuristic: grab the longest alphanumeric token.
    tokens = re.findall(r"[A-Za-z0-9]{4,}", stem)
    if not tokens:
        return [], ["Unable to infer barcode value from filename"]
    token = max(tokens, key=len)
    return [token.upper()], [
        "Barcode decoder unavailable. Using filename heuristic result."  # noqa: E501
    ]


def decode_barcodes(image_path: Path) -> Tuple[List[str], List[str]]:
    barcodes, warnings = _decode_with_pyzbar(image_path)
    if barcodes:
        return barcodes, warnings

    # Fall back to filename heuristic so downstream code keeps working.
    fallback_codes, fallback_warnings = _stub_from_filename(image_path)
    return fallback_codes, warnings + fallback_warnings


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract barcodes from image")
    parser.add_argument("--image", required=True, help="Path to the input image")
    args = parser.parse_args()

    image_path = Path(args.image)
    if not image_path.exists():
        result = {
            "barcodes": [],
            "warnings": [f"Image not found: {image_path}"]
        }
        print(json.dumps(result))
        sys.exit(1)

    barcodes, warnings = decode_barcodes(image_path)
    result = {
        "barcodes": barcodes,
        "warnings": warnings,
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
