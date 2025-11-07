#!/usr/bin/env python3
"""Decode PDF417 barcodes from an image using a robust multi-pass pipeline."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

# Lazily imported dependencies (populated by ``_load_dependencies``)
np = None  # type: ignore[assignment]
cv2 = None  # type: ignore[assignment]
Image = None  # type: ignore[assignment]
ImageOps = None  # type: ignore[assignment]
ImageEnhance = None  # type: ignore[assignment]
ImageFilter = None  # type: ignore[assignment]
zxingcpp = None  # type: ignore[assignment]


def _load_dependencies() -> None:
    """Import heavy dependencies on demand.

    Import errors are surfaced as ``RuntimeError`` so the Node.js caller can
    gracefully fall back to stub data.
    """

    global np, cv2, Image, ImageOps, ImageEnhance, ImageFilter, zxingcpp

    if np is not None:
        return

    try:
        import numpy as _np  # type: ignore
        import cv2 as _cv2  # type: ignore
        from PIL import Image as _Image  # type: ignore
        from PIL import ImageEnhance as _ImageEnhance  # type: ignore
        from PIL import ImageFilter as _ImageFilter  # type: ignore
        from PIL import ImageOps as _ImageOps  # type: ignore
        import zxingcpp as _zxingcpp  # type: ignore
    except Exception as exc:  # pragma: no cover - import guard
        raise RuntimeError(f"Required dependency missing or failed to import: {exc}") from exc

    np = _np
    cv2 = _cv2
    Image = _Image
    ImageOps = _ImageOps
    ImageEnhance = _ImageEnhance
    ImageFilter = _ImageFilter
    zxingcpp = _zxingcpp

    try:  # Optional HEIC support
        import pillow_heif  # type: ignore  # noqa: F401
        from pillow_heif import register_heif_opener  # type: ignore

        register_heif_opener()
    except Exception:  # pragma: no cover - best effort
        pass


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def exif_fix(img):
    return ImageOps.exif_transpose(img).convert("RGB")


def resize_to_width(img, target_w: int):
    if target_w <= 0 or img.width <= target_w:
        return img
    h = int(round(img.height * (target_w / img.width)))
    return img.resize((target_w, h), Image.LANCZOS)


def pil_to_np(img):
    return np.array(img)


def np_to_pil(arr):
    return Image.fromarray(arr)


def iter_points_from_position(pos: Any) -> List[Tuple[int, int]]:
    if pos is None:
        return []
    try:
        return [(int(p.x), int(p.y)) for p in pos]
    except TypeError:
        pass
    if hasattr(pos, "points"):
        try:
            return [(int(p.x), int(p.y)) for p in pos.points]
        except Exception:
            pass
    corners: List[Tuple[int, int]] = []
    for name in ("top_left", "top_right", "bottom_right", "bottom_left"):
        if hasattr(pos, name):
            pt = getattr(pos, name)
            if hasattr(pt, "x") and hasattr(pt, "y"):
                corners.append((int(pt.x), int(pt.y)))
    if corners:
        return corners
    if hasattr(pos, "x") and hasattr(pos, "y"):
        return [(int(pos.x), int(pos.y))]
    return []


def bounding_rect_from_points_like(pos: Any) -> Tuple[int, int, int, int]:
    pts = iter_points_from_position(pos)
    if not pts:
        return 0, 0, 0, 0
    xs = [x for x, _ in pts]
    ys = [y for _, y in pts]
    return min(xs), min(ys), max(xs), max(ys)


PDF417 = None


def _ensure_pdf417_format() -> None:
    global PDF417
    if PDF417 is None:
        PDF417 = zxingcpp.BarcodeFormat.PDF417


def zxing_pdf417(arr_rgb, try_downscale: bool = True, binarizer=None, try_rotate: bool = False):
    _ensure_pdf417_format()
    kwargs = dict(formats=PDF417, try_rotate=try_rotate, try_downscale=try_downscale)
    if binarizer is not None:
        kwargs["binarizer"] = binarizer
    return zxingcpp.read_barcodes(arr_rgb, **kwargs)


def clahe_rgb(pil_img):
    gray = cv2.cvtColor(pil_to_np(pil_img), cv2.COLOR_RGB2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    g2 = clahe.apply(gray)
    return np_to_pil(cv2.cvtColor(g2, cv2.COLOR_GRAY2RGB))


def unsharp(pil_img, radius: float = 1.2, amount: float = 1.6):
    return pil_img.filter(ImageFilter.UnsharpMask(radius=radius, percent=int(amount * 100), threshold=0))


def rotate_small(pil_img, deg: float):
    return pil_img.rotate(deg, resample=Image.BICUBIC, expand=True)


def _check_variant_impl(v_tuple):
    v, try_downscale_options, binarizers, try_rotate = v_tuple
    a = pil_to_np(v)
    for td in try_downscale_options:
        for b in binarizers:
            res = zxing_pdf417(a, try_downscale=td, binarizer=b, try_rotate=try_rotate)
            if res:
                return res
            res = zxing_pdf417(255 - a, try_downscale=td, binarizer=b, try_rotate=try_rotate)
            if res:
                return res
    return []


def decode_single_view_pdf417(arr_rgb, try_downscale_options: Sequence[bool] = (True, False), try_rotate: bool = False):
    pil = np_to_pil(arr_rgb)
    variants = [
        pil,
        ImageEnhance.Contrast(pil).enhance(1.25),
        ImageEnhance.Sharpness(pil).enhance(1.2),
        ImageEnhance.Sharpness(ImageOps.grayscale(pil).convert("RGB")).enhance(1.4),
        clahe_rgb(pil),
        unsharp(pil, 1.2, 1.6),
    ]
    binarizers = [None]
    for name in ("LocalAverage", "FixedThreshold"):
        b = getattr(zxingcpp.Binarizer, name, None)
        if b is not None:
            binarizers.append(b)

    tasks = [(v, try_downscale_options, binarizers, try_rotate) for v in variants]

    from concurrent.futures import ThreadPoolExecutor, as_completed

    with ThreadPoolExecutor(max_workers=len(tasks)) as executor:
        futures = [executor.submit(_check_variant_impl, task) for task in tasks]
        for future in as_completed(futures):
            res = future.result()
            if res:
                executor.shutdown(wait=False, cancel_futures=True)
                return res
    return []


def decode_rotations_and_skews_pdf417(arr_rgb):
    for k in range(4):
        rot = np.rot90(arr_rgb, k=k)
        res = decode_single_view_pdf417(rot)
        if res:
            return res
        pil = np_to_pil(rot)
        for deg in (-7, -4, -2, 2, 4, 7):
            skew = pil_to_np(rotate_small(pil, deg))
            res = decode_single_view_pdf417(skew)
            if res:
                return res
    return []


def adaptive_bins(gray):
    outs = []
    for blk in (11, 15, 21):
        for C in (2, 5, 8):
            outs.append(cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, blk, C))
            outs.append(cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY_INV, blk, C))
    _, otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    _, otsu_i = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    outs += [otsu, otsu_i]
    return outs


def pdf417_heavy_decode(arr_rgb):
    H, W = arr_rgb.shape[:2]
    regions = [arr_rgb, arr_rgb[int(H * 0.45):, :]]
    for region_idx, region in enumerate(regions):
        if region.shape[0] == 0 or region.shape[1] == 0:
            continue
        base = np_to_pil(region)
        pre_vars = [base, clahe_rgb(base), unsharp(base, 1.2, 1.8)]
        for pv in pre_vars:
            pv_np = pil_to_np(pv)
            gray = cv2.cvtColor(pv_np, cv2.COLOR_RGB2GRAY)
            for bimg in adaptive_bins(gray):
                m = cv2.morphologyEx(bimg, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), 1)
                m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3)), 1)
                m_rgb = cv2.cvtColor(m, cv2.COLOR_GRAY2RGB)
                for scale in (1.0, 1.5, 2.0):
                    up = cv2.resize(m_rgb, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
                    for img_try in (up, 255 - up):
                        r = zxing_pdf417(img_try, try_downscale=False, try_rotate=True)
                        if r:
                            if region_idx == 0:
                                return r
                            shift_y = int(H * 0.45)
                            shifted_r = []
                            for rr in r:
                                new_rr = SimpleNamespace()
                                new_rr.text = rr.text
                                pts = iter_points_from_position(rr.position)
                                if pts:
                                    new_pts = [SimpleNamespace(x=x, y=y + shift_y) for (x, y) in pts]
                                    new_rr.position = new_pts
                                else:
                                    new_rr.position = rr.position
                                shifted_r.append(new_rr)
                            return shifted_r
    return []


def iou(a, b):
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    iw, ih = max(0, ix1 - ix0), max(0, iy1 - iy0)
    inter = iw * ih
    if inter == 0:
        return 0.0
    area_a = (ax1 - ax0) * (ay1 - ay0)
    area_b = (bx1 - bx0) * (by1 - by0)
    return inter / (area_a + area_b - inter + 1e-6)


def propose_rois_for_pdf417(img_rgb, max_candidates: int = 12, min_area_frac: float = 0.00008):
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    grad = cv2.Sobel(gray, cv2.CV_16S, 1, 0, ksize=3)
    grad = cv2.convertScaleAbs(grad)
    norm = cv2.normalize(grad, None, 0, 255, cv2.NORM_MINMAX)
    _, bw = cv2.threshold(norm, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    closed = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (21, 3)), iterations=2)
    opened = cv2.morphologyEx(closed, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), iterations=1)
    contours, _ = cv2.findContours(opened, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    H, W = gray.shape
    img_area = H * W
    cand: List[Tuple[float, Tuple[int, int, int, int]]] = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        area = w * h
        if area < min_area_frac * img_area:
            continue
        aspect = w / (h + 1e-6)
        score = area * max(aspect, 1.0)
        pad = max(8, int(0.015 * max(W, H)))
        x0, y0 = max(x - pad, 0), max(y - pad, 0)
        x1, y1 = min(x + w + pad, W), min(y + h + pad, H)
        cand.append((score, (x0, y0, x1, y1)))
    cand.sort(key=lambda t: t[0], reverse=True)
    picked: List[Tuple[int, int, int, int]] = []
    for _, box in cand:
        if len(picked) >= max_candidates:
            break
        if all(iou(box, bx) <= 0.6 for bx in picked):
            picked.append(box)
    return picked


def shift_results(results: Sequence[Any], x_off: int, y_off: int) -> List[Any]:
    new_results = []
    for r in results:
        pts = iter_points_from_position(getattr(r, "position", None))
        new_r = SimpleNamespace()
        new_r.text = getattr(r, "text", "")
        if pts:
            new_pts = [SimpleNamespace(x=x + x_off, y=y + y_off) for (x, y) in pts]
            new_r.position = new_pts
        else:
            new_r.position = getattr(r, "position", None)
        new_results.append(new_r)
    return new_results


def decode_rois(img_arr, rois, debug_dir: Optional[str], tag: str = ""):
    for (x0, y0, x1, y1) in rois:
        crop = img_arr[y0:y1, x0:x1].copy()
        if crop.shape[0] == 0 or crop.shape[1] == 0:
            continue
        if crop.shape[1] < 900:
            crop = cv2.resize(crop, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
        r = pdf417_heavy_decode(crop)
        if not r:
            r = decode_rotations_and_skews_pdf417(crop)
        if r:
            if debug_dir:
                ensure_dir(debug_dir)
                np_to_pil(crop).save(os.path.join(debug_dir, f"roi_{tag}_{x0}_{y0}_{x1}_{y1}.jpg"), quality=92)
            return shift_results(r, x0, y0)
    return []


def decode_fullsheet_pdf417(img, max_width: int, max_candidates: int, debug: bool, src_path: str):
    debug_dir = os.path.join(os.path.dirname(src_path), "debug_crops") if debug else None
    full = exif_fix(img)
    full_rgb = pil_to_np(full)
    H, W = full_rgb.shape[:2]

    rois_main = propose_rois_for_pdf417(full_rgb, max_candidates=max_candidates)
    res = decode_rois(full_rgb, rois_main, debug_dir, tag="main")
    if res:
        return res

    full_rgb_rot90 = np.rot90(full_rgb)
    rois_rot = propose_rois_for_pdf417(full_rgb_rot90, max_candidates=max_candidates)
    res_rot = decode_rois(full_rgb_rot90, rois_rot, debug_dir, tag="rot")
    if res_rot:
        unrotated_results = []
        for r in res_rot:
            new_r = SimpleNamespace()
            new_r.text = getattr(r, "text", "")
            pts = iter_points_from_position(getattr(r, "position", None))
            if pts:
                new_pts = [SimpleNamespace(x=W - 1 - y_r, y=x_r) for (x_r, y_r) in pts]
                new_r.position = new_pts
            else:
                new_r.position = getattr(r, "position", None)
            unrotated_results.append(new_r)
        return unrotated_results

    res = pdf417_heavy_decode(full_rgb)
    if res:
        return res

    res = decode_rotations_and_skews_pdf417(full_rgb)
    if res:
        return res

    coarse = resize_to_width(full, max_width)
    scale_x = full.width / coarse.width
    scale_y = full.height / coarse.height
    coarse_hits = decode_rotations_and_skews_pdf417(pil_to_np(coarse))
    if coarse_hits:
        outs = []
        H, W = full_rgb.shape[:2]
        mapped = []
        for r in coarse_hits:
            new_r = SimpleNamespace()
            new_r.text = getattr(r, "text", "")
            pts = iter_points_from_position(getattr(r, "position", None))
            if pts:
                scaled = [SimpleNamespace(x=x * scale_x, y=y * scale_y) for (x, y) in pts]
                new_r.position = scaled
            else:
                new_r.position = getattr(r, "position", None)
            mapped.append(new_r)

        for r in mapped:
            x0, y0, x1, y1 = bounding_rect_from_points_like(getattr(r, "position", None))
            x0, y0 = max(int(x0 - 28), 0), max(int(y0 - 28), 0)
            x1, y1 = min(int(x1 + 28), W), min(int(y1 + 28), H)
            if x1 <= x0 or y1 <= y0:
                continue
            roi = full_rgb[y0:y1, x0:x1].copy()
            if roi.shape[1] < 900:
                roi = cv2.resize(roi, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
            r2 = decode_rotations_and_skews_pdf417(roi)
            if r2:
                if debug_dir:
                    ensure_dir(debug_dir)
                    np_to_pil(roi).save(os.path.join(debug_dir, f"refined_{x0}_{y0}_{x1}_{y1}.jpg"), quality=92)
                outs.extend(shift_results(r2, x0, y0))
        if outs:
            return outs
    return []


def _format_position(points: Iterable[Tuple[int, int]]) -> Dict[str, Any]:
    pts = list(points)
    if not pts:
        return {}
    if len(pts) == 4:
        labels = ("top_left", "top_right", "bottom_right", "bottom_left")
        return {label: [float(x), float(y)] for label, (x, y) in zip(labels, pts)}
    return {"points": [[float(x), float(y)] for x, y in pts]}


def decode_barcodes(image_path: Path, *, max_width: int = 2400, max_candidates: int = 12, debug: bool = False) -> List[Dict[str, Any]]:
    _load_dependencies()

    with Image.open(image_path) as img:
        results = decode_fullsheet_pdf417(img, max_width, max_candidates, debug, str(image_path))

    output: List[Dict[str, Any]] = []
    for result in results:
        text = getattr(result, "text", "")
        if not text:
            continue
        entry: Dict[str, Any] = {"text": text, "format": "PDF417"}
        position_points = iter_points_from_position(getattr(result, "position", None))
        if position_points:
            entry["position"] = _format_position(position_points)
        symbology = getattr(result, "symbology_identifier", None)
        if symbology:
            entry["symbology_identifier"] = symbology
        is_gs1 = getattr(result, "is_gs1", None)
        if is_gs1 is not None:
            entry["is_gs1"] = bool(is_gs1)
        output.append(entry)

    return output


def _parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Decode PDF417 barcodes from an image")
    parser.add_argument("image", nargs="?", help="Path to the image to decode")
    parser.add_argument("--image", dest="image_flag", help="Alternate flag form for the image path")
    parser.add_argument("--max-width", type=int, default=2400, help="Downscale width for coarse pass (0 = no downscale)")
    parser.add_argument("--max-candidates", type=int, default=12, help="Maximum ROI candidates to inspect")
    parser.add_argument("--debug", action="store_true", help="Persist intermediate crops for inspection")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = _parse_args(argv)

    image_arg = args.image_flag or args.image
    if not image_arg:
        print(json.dumps([]))
        return 1

    image_path = Path(image_arg)
    if not image_path.exists():
        print(json.dumps([]))
        return 1

    try:
        barcodes = decode_barcodes(
            image_path,
            max_width=int(args.max_width),
            max_candidates=int(args.max_candidates),
            debug=bool(args.debug),
        )
    except Exception as exc:  # pragma: no cover - passthrough for Node consumer
        print(json.dumps({"error": str(exc)}))
        return 2

    print(json.dumps(barcodes, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
