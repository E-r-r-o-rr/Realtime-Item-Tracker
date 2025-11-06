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
from typing import Any, Dict, Iterable, List, Optional, Tuple


def _load_dependencies() -> Tuple[Any, Any, Any, Any, Any, Any]:
    try:
        from PIL import Image, ImageEnhance, ImageOps  # type: ignore
    except Exception as exc:  # pragma: no cover - import guard
        raise RuntimeError(f"Pillow dependency missing or failed to import: {exc}") from exc

    try:
        import numpy as np  # type: ignore
    except Exception as exc:  # pragma: no cover - import guard
        raise RuntimeError(f"NumPy dependency missing or failed to import: {exc}") from exc

    try:
        import cv2  # type: ignore
    except Exception as exc:  # pragma: no cover - import guard
        raise RuntimeError(f"OpenCV dependency missing or failed to import: {exc}") from exc

    try:
        import zxingcpp  # type: ignore
    except Exception as exc:  # pragma: no cover - import guard
        raise RuntimeError(f"zxing-cpp dependency missing or failed to import: {exc}") from exc

    return Image, ImageEnhance, ImageOps, np, cv2, zxingcpp


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


def _pil_to_cv(img: Any, cv2: Any, np: Any) -> Any:
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def _fit_width(img: Any, Image: Any, target_width: int = 1600) -> Any:
    if img.width <= target_width:
        return img
    ratio = target_width / float(img.width)
    target_height = int(img.height * ratio)
    return img.resize((target_width, target_height), Image.LANCZOS)


def _prep_variants(
    img: Any,
    Image: Any,
    ImageEnhance: Any,
    ImageOps: Any,
    np: Any,
    cv2: Any,
) -> Iterable[Any]:
    base = ImageOps.exif_transpose(img).convert("RGB")
    base = _fit_width(base, Image)

    variants: List[Any] = [base]
    variants.append(ImageEnhance.Contrast(base).enhance(1.25))
    variants.append(ImageEnhance.Sharpness(base).enhance(1.2))

    gray = ImageOps.grayscale(base).convert("RGB")
    variants.append(ImageEnhance.Sharpness(gray).enhance(1.4))

    try:
        cv = _pil_to_cv(base, cv2, np)
        gray_cv = cv2.cvtColor(cv, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray_cv, 50, 150)
        lines = cv2.HoughLines(edges, 1, np.pi / 180, 180)
        if lines is not None and len(lines) > 0:
            angles = [theta for rho, theta in lines[:, 0]]
            angle = float(np.degrees(np.median(angles))) - 90.0
            rotated = base.rotate(-angle, resample=Image.BICUBIC, expand=True)
            variants.append(rotated)
    except Exception:
        pass

    return variants


def _decode_variant(arr: Any, zxingcpp: Any) -> List[Any]:
    barcode_formats = (
        zxingcpp.BarcodeFormat.AZTEC
        | zxingcpp.BarcodeFormat.CODABAR
        | zxingcpp.BarcodeFormat.CODE39
        | zxingcpp.BarcodeFormat.CODE93
        | zxingcpp.BarcodeFormat.CODE128
        | zxingcpp.BarcodeFormat.EAN8
        | zxingcpp.BarcodeFormat.EAN13
        | zxingcpp.BarcodeFormat.ITF
        | zxingcpp.BarcodeFormat.PDF417
        | zxingcpp.BarcodeFormat.QR_CODE
        | zxingcpp.BarcodeFormat.DATA_MATRIX
    )

    return zxingcpp.read_barcodes(
        arr,
        try_harder=True,
        try_rotate=True,
        formats=barcode_formats,
    )


def decode_barcodes(image_path: Path) -> List[Dict[str, Any]]:
    Image, ImageEnhance, ImageOps, np, cv2, zxingcpp = _load_dependencies()

    with Image.open(image_path) as img:
        variants = list(_prep_variants(img, Image, ImageEnhance, ImageOps, np, cv2))

    results: List[Any] = []
    for variant in variants:
        arr = np.array(variant)
        variant_results = _decode_variant(arr, zxingcpp)
        if variant_results:
            results = variant_results
            break
        inverted_results = _decode_variant(255 - arr, zxingcpp)
        if inverted_results:
            results = inverted_results
            break

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
