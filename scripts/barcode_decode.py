#!/usr/bin/env python3
"""Decode barcodes from an image using zxing-cpp.

This script mirrors the standalone helper provided by the customer so the
Node.js layer can invoke it directly. It accepts the image path as either a
positional argument or via ``--image`` for backwards compatibility and prints a
JSON array with one entry per detected barcode. Each entry exposes the decoded
text along with metadata such as format and position coordinates when
available.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def _load_dependencies() -> Tuple[Any, Any]:
    try:
        from PIL import Image  # type: ignore
    except Exception as exc:  # pragma: no cover - import guard
        raise RuntimeError(f"Pillow dependency missing or failed to import: {exc}") from exc

    try:
        import zxingcpp  # type: ignore
    except Exception as exc:  # pragma: no cover - import guard
        raise RuntimeError(f"zxing-cpp dependency missing or failed to import: {exc}") from exc

    return Image, zxingcpp


def _position_dict(position: Any) -> Optional[Dict[str, Tuple[float, float]]]:
    if position is None:
        return None

    corners = (
        getattr(position, "top_left", None),
        getattr(position, "top_right", None),
        getattr(position, "bottom_right", None),
        getattr(position, "bottom_left", None),
    )
    if not all(corners):
        try:
            return json.loads(str(position))  # type: ignore[arg-type]
        except Exception:
            return None

    return {
        "top_left": (position.top_left.x, position.top_left.y),
        "top_right": (position.top_right.x, position.top_right.y),
        "bottom_right": (position.bottom_right.x, position.bottom_right.y),
        "bottom_left": (position.bottom_left.x, position.bottom_left.y),
    }


def decode_barcodes(image_path: Path) -> List[Dict[str, Any]]:
    Image, zxingcpp = _load_dependencies()

    with Image.open(image_path) as img:
        results = zxingcpp.read_barcodes(img)

    output: List[Dict[str, Any]] = []
    for result in results:
        entry: Dict[str, Any] = {
            "text": getattr(result, "text", ""),
            "format": str(getattr(result, "format", "")),
        }
        symbology = getattr(result, "symbology_identifier", None)
        if symbology is not None:
            entry["symbology_identifier"] = symbology
        is_gs1 = getattr(result, "is_gs1", None)
        if is_gs1 is not None:
            entry["is_gs1"] = bool(is_gs1)
        position = _position_dict(getattr(result, "position", None))
        if position is not None:
            entry["position"] = position
        output.append(entry)

    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Decode barcodes from an image")
    parser.add_argument("image", nargs="?", help="Path to the image to decode")
    parser.add_argument("--image", dest="image_flag", help="Alternate flag form for the image path")
    args = parser.parse_args()

    image_arg = args.image_flag or args.image or "2_page-0001.jpg"
    image_path = Path(image_arg)
    if not image_path.exists():
        print(json.dumps([]))
        return 1

    try:
        barcodes = decode_barcodes(image_path)
    except Exception as exc:  # pragma: no cover - passthrough
        print(json.dumps({"error": str(exc)}))
        return 2

    print(json.dumps(barcodes, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
