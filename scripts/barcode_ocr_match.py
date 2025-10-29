#!/usr/bin/env python3
"""Compare OCR JSON with decoded barcode text using global assignment."""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, DefaultDict, Dict, List, Optional, Tuple

try:  # optional dependency
    from scipy.optimize import linear_sum_assignment  # type: ignore
    HAS_SCIPY = True
except Exception:  # pragma: no cover - SciPy optional
    HAS_SCIPY = False


def to_jsonable(obj: Any) -> Any:
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, dict):
        return {to_jsonable(k): to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [to_jsonable(x) for x in obj]
    try:
        import numpy as np  # type: ignore

        if isinstance(obj, np.generic):
            return obj.item()
        if isinstance(obj, np.ndarray):
            return obj.tolist()
    except Exception:
        pass
    try:
        import pandas as pd  # type: ignore

        if isinstance(obj, pd.Timestamp):
            return obj.isoformat()
    except Exception:
        pass
    return str(obj)


SEP_LINE = re.compile(r"^[-\s]{8,}$")
TIME_RX = re.compile(r"\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\b", re.I)
FULL_TIME_RX = re.compile(r"^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*$", re.I)
DATE_RX1 = re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b")
DATE_RX2 = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
DATE_RX = re.compile(DATE_RX1.pattern + r"|" + DATE_RX2.pattern)
TRK_RX = re.compile(r"\b(?:TRK|TRUCK)\s*[- ]?\d{2,6}\b", re.I)
WH_RX = re.compile(r"\bWH-?\d{1,3}\b", re.I)
RACK_RX = re.compile(r"\b(?:WH-?\d{1,3}|[A-Z]\d{2,3})\b", re.I)
ALNUM_LONG = re.compile(r"(?=[A-Z0-9\-]*\d)[A-Z0-9\-]{8,}", re.I)
CODE_SHORT_RX = re.compile(r"(?=[A-Z0-9]*\d)[A-Z0-9\-]{5,12}", re.I)
DIGIT_ONLY_RX = re.compile(r"^\d{1,4}$")
LABEL_COLON_RX = re.compile(r"([A-Za-z][A-Za-z0-9 /#\-\(\)]{1,32})\s*:\s*")
CELL_COLON_RX = re.compile(r"^\s*[A-Za-z][A-Za-z0-9 /#\-\(\)]{1,32}\s*:\s*\S")
ALNUM = r"[A-Za-z0-9]"


def norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "")).strip()


def norm_case_space(s: str) -> str:
    return norm_text(s).upper()


def norm_label(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def labels_match(ocr_key: str, lbl: str) -> float:
    nk = norm_label(ocr_key)
    nl = norm_label(lbl)
    if not nk or not nl:
        return 0.0
    if nk == nl:
        return 1.0
    import difflib

    return difflib.SequenceMatcher(None, nk, nl).ratio()


def get_lines(text: str) -> List[str]:
    return text.replace("\r\n", "\n").replace("\r", "\n").split("\n")


def find_line_bounds(text: str, idx: int) -> Tuple[int, int]:
    start = text.rfind("\n", 0, idx) + 1
    end = text.find("\n", idx)
    end = len(text) if end == -1 else end
    return start, end


def norm_time_tuple_full(s: str) -> Optional[Tuple[int, int, int, Optional[str]]]:
    if not s:
        return None
    m = FULL_TIME_RX.fullmatch(s)
    if not m:
        return None
    hh = int(m.group(1))
    mm = int(m.group(2))
    ss = int(m.group(3) or 0)
    mer = (m.group(4) or "").upper() or None
    h24 = hh
    if mer == "PM" and hh != 12:
        h24 = hh + 12
    if mer == "AM" and hh == 12:
        h24 = 0
    return (h24, mm, ss, mer)


def times_equal_flexible(ocr_val: str, bc_val: str) -> bool:
    A = norm_time_tuple_full(ocr_val)
    B = norm_time_tuple_full(bc_val)
    if not A or not B:
        return False
    ah, am, _, amer = A
    bh, bm, _, bmer = B
    if (amer is not None) or (bmer is not None):
        if amer is None or bmer is None:
            return False
        if amer != bmer:
            return False
    return ah == bh and am == bm


def norm_date_tuple(s: str) -> Optional[Tuple[int, int, int]]:
    if not s:
        return None
    m2 = DATE_RX2.search(s)
    if m2:
        y, mo, d = int(m2.group(1)), int(m2.group(2)), int(m2.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            return (y, mo, d)
        return None
    m1 = DATE_RX1.search(s)
    if not m1:
        return None
    a, b, y = int(m1.group(1)), int(m1.group(2)), int(m1.group(3))
    if a > 12 and b <= 12:
        d, mo = a, b
    else:
        mo, d = a, b
    if 1 <= mo <= 12 and 1 <= d <= 31:
        return (y, mo, d)
    return None


def dates_equal_flexible(ocr_val: str, bc_val: str) -> bool:
    A = norm_date_tuple(ocr_val)
    B = norm_date_tuple(bc_val)
    return (A is not None) and (B is not None) and (A == B)


def anchored_value_regex(value: str) -> re.Pattern[str]:
    s = value or ""
    esc = re.escape(s).replace(r"\ ", r"\s+")
    prefix = r"(?<!%s)" % ALNUM if re.match(ALNUM, s) else ""
    suffix = r"(?!%s)" % ALNUM if re.search(ALNUM + r"$", s) else ""
    return re.compile(prefix + esc + suffix, re.I)


def find_value_in_text_strict(value: str, text: str) -> Optional[Tuple[int, int, str]]:
    if not value:
        return None
    pat = anchored_value_regex(value)
    m = pat.search(text)
    if m:
        return (m.start(), m.end(), m.group(0))
    return None


def value_is_substring_token(needle: str, hay: str) -> bool:
    if not needle or not hay:
        return False
    pat = anchored_value_regex(needle)
    return bool(pat.search(hay))


def looks_valueish(tokens: List[str]) -> bool:
    for t in tokens:
        if TIME_RX.search(t) or DATE_RX.search(t) or re.search(r"\d", t):
            return True
    return False


def split_fields(line: str) -> List[str]:
    if "\t" in line:
        parts = [p for p in re.split(r"\t+", line) if p.strip()]
    else:
        parts = [p for p in re.split(r"\s{2,}", line) if p.strip()]
    return [p.strip() for p in parts]


def classify_value(v: str) -> str:
    if not v or not v.strip():
        return "empty"
    if TIME_RX.search(v):
        return "time"
    if DATE_RX.search(v):
        return "date"
    if TRK_RX.search(v):
        return "truck"
    if WH_RX.search(v):
        return "wh"
    if RACK_RX.search(v):
        return "rack"
    if ALNUM_LONG.search(v):
        return "alnum_long"
    if CODE_SHORT_RX.search(v):
        return "code_short"
    if DIGIT_ONLY_RX.match(v):
        return "small_int"
    return "string"


def equal_strict_or_flexible(ocr_val: str, bc_val: str) -> bool:
    o = norm_case_space(ocr_val)
    b = norm_case_space(bc_val)
    if o == b:
        return True
    if FULL_TIME_RX.fullmatch(ocr_val) and FULL_TIME_RX.fullmatch(bc_val):
        return times_equal_flexible(ocr_val, bc_val)
    if DATE_RX.search(ocr_val) and DATE_RX.search(bc_val):
        return dates_equal_flexible(ocr_val, bc_val)
    return False


def infer_label_on_line(line: str, match_span: Tuple[int, int]) -> Optional[str]:
    mstart, _ = match_span
    last = None
    for m in LABEL_COLON_RX.finditer(line):
        if m.end() <= mstart:
            last = m
        else:
            break
    if last:
        return last.group(1).strip()
    toks = line.split("\t")
    acc = 0
    for i, t in enumerate(toks):
        seg_end = acc + len(t)
        if acc <= mstart <= seg_end:
            if i > 0 and toks[i - 1].strip():
                return toks[i - 1].strip()
            break
        acc = seg_end + 1
    parts = re.split(r"\s{2,}", line)
    acc = 0
    for i, p in enumerate(parts):
        seg_end = acc + len(p)
        if acc <= mstart <= seg_end:
            if i > 0 and parts[i - 1].strip():
                return parts[i - 1].strip()
            break
        acc = seg_end + 2
    return None


def _is_colon_cell(s: str) -> bool:
    return bool(CELL_COLON_RX.match(s or ""))


def parse_pairs_for_context(text: str) -> List[Dict[str, str]]:
    pairs: List[Dict[str, str]] = []
    lines = get_lines(text)
    i = 0
    while i < len(lines):
        ln = lines[i].strip()
        if not ln or SEP_LINE.match(ln):
            i += 1
            continue

        for m in re.finditer(
            r"([A-Za-z][A-Za-z0-9 /#\-\(\)]{1,32})\s*:\s*([^\t]+?)(?=(?:\s{2,}|\t+|$|[A-Za-z][A-Za-z0-9 /#\-\(\)]{1,32}\s*:))",
            ln,
        ):
            lbl = m.group(1).strip()
            val = m.group(2).strip()
            if val:
                pairs.append({"label": lbl, "value": val})

        toks = split_fields(ln)
        n = len(toks)
        if n >= 2:
            if n == 2:
                if _is_colon_cell(toks[0]) and _is_colon_cell(toks[1]):
                    i += 1
                    continue
                pairs.append({"label": toks[0], "value": toks[1]})
                i += 1
                continue

            j = i + 1
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines):
                nxt = split_fields(lines[j])
                if len(nxt) == n and looks_valueish(nxt) and not looks_valueish(toks):
                    for a, b in zip(toks, nxt):
                        pairs.append({"label": a, "value": b})
                    i = j + 1
                    continue

            if n % 2 == 0 and looks_valueish(toks):
                if all(_is_colon_cell(t) for t in toks):
                    for cell in toks:
                        m = re.match(r"^\s*([A-Za-z][A-Za-z0-9 /#\-\(\)]{1,32})\s*:\s*(.+)$", cell)
                        if m:
                            pairs.append({"label": m.group(1).strip(), "value": m.group(2).strip()})
                    i += 1
                    continue

                for k in range(0, n, 2):
                    if k + 1 < n:
                        pairs.append({"label": toks[k], "value": toks[k + 1]})
                i += 1
                continue

        i += 1

    seen = set()
    dedup: List[Dict[str, str]] = []
    for p in pairs:
        key = (p["label"], p["value"])
        if key not in seen:
            dedup.append(p)
            seen.add(key)
    return dedup


def build_barcode_library(text: str) -> Tuple[DefaultDict[Tuple[str, str], List[Dict[str, str]]], List[Dict[str, str]], List[Dict[str, str]]]:
    entries: List[Dict[str, str]] = []
    labeled_pairs = parse_pairs_for_context(text)

    present_keys = set()

    for p in labeled_pairs:
        lbl, val = p["label"].strip(), p["value"].strip()
        if not val:
            continue

        vclass = classify_value(val)
        keep = False

        if vclass in {"time", "date", "truck", "wh", "rack", "alnum_long", "code_short"}:
            keep = True
        elif vclass == "small_int":
            keep = bool(re.search(r"[A-Za-z]", lbl))
        else:
            if re.fullmatch(r"[A-Za-z][A-Za-z0-9 /#\-\(\)]{1,32}", lbl):
                if not re.fullmatch(r"[A-Za-z][A-Za-z0-9 /#\-\(\)]{1,32}", val):
                    keep = True
                elif len(val) >= 4 and (" " in val or re.search(r"[A-Z][a-z]+", val)):
                    keep = True

        if keep:
            entries.append({"label": lbl, "value": val, "class": vclass})
            present_keys.add((norm_case_space(val), vclass))

    raw = text
    for m in ALNUM_LONG.finditer(raw):
        v, cls = m.group(0), "alnum_long"
        key = (norm_case_space(v), cls)
        if key not in present_keys:
            entries.append({"label": "", "value": v, "class": cls})
            present_keys.add(key)
    for m in TRK_RX.finditer(raw):
        v, cls = m.group(0), "truck"
        key = (norm_case_space(v), cls)
        if key not in present_keys:
            entries.append({"label": "Truck", "value": v, "class": cls})
            present_keys.add(key)
    for m in WH_RX.finditer(raw):
        v, cls = m.group(0), "wh"
        key = (norm_case_space(v), cls)
        if key not in present_keys:
            entries.append({"label": "WH", "value": v, "class": cls})
            present_keys.add(key)
    for m in TIME_RX.finditer(raw):
        v, cls = m.group(0), "time"
        key = (norm_case_space(v), cls)
        if key not in present_keys:
            entries.append({"label": "Time", "value": v, "class": cls})
            present_keys.add(key)
    for m in DATE_RX.finditer(raw):
        v, cls = m.group(0), "date"
        key = (norm_case_space(v), cls)
        if key not in present_keys:
            entries.append({"label": "Date", "value": v, "class": cls})
            present_keys.add(key)

    lib_map: DefaultDict[Tuple[str, str], List[Dict[str, str]]] = defaultdict(list)
    for e in entries:
        lib_map[(norm_case_space(e["value"]), e["class"])].append(e)

    return lib_map, entries, labeled_pairs


def pair_cost(ocr_key: str, ocr_val: str, p: Dict[str, str]) -> float:
    lab_sim = labels_match(ocr_key, p["label"])
    lab_cost = 1.0 - lab_sim

    if equal_strict_or_flexible(ocr_val, p["value"]):
        v_cost = 0.0
    elif value_is_substring_token(ocr_val, p["value"]):
        v_cost = 0.75
    else:
        v_cost = 1.0

    o_cls = classify_value(ocr_val)
    p_cls = classify_value(p["value"])
    same_time = FULL_TIME_RX.search(ocr_val) and FULL_TIME_RX.search(p["value"])
    same_date = DATE_RX.search(ocr_val) and DATE_RX.search(p["value"])
    t_pen = 0.0 if (o_cls == p_cls or same_time or same_date) else 0.25

    return 0.6 * lab_cost + 0.35 * v_cost + 0.05 * t_pen


def build_cost_matrix(expected_items: List[Tuple[str, str]], pairs: List[Dict[str, str]]) -> List[List[float]]:
    M, N = len(expected_items), len(pairs)
    C = [[1.5 for _ in range(N)] for _ in range(M)]
    for i, (k, v) in enumerate(expected_items):
        sv = "" if v is None else str(v)
        for j, p in enumerate(pairs):
            C[i][j] = pair_cost(k, sv, p)
    return C


def greedy_assign(C: List[List[float]], thresh: float) -> Tuple[List[int], List[int]]:
    M, N = len(C), len(C[0]) if C else 0
    used_i, used_j = set(), set()
    row_idx: List[int] = []
    col_idx: List[int] = []
    while True:
        best = (None, None, float("inf"))
        for i in range(M):
            if i in used_i:
                continue
            for j in range(N):
                if j in used_j:
                    continue
                cost = C[i][j]
                if cost < best[2]:
                    best = (i, j, cost)
        i, j, cost = best
        if i is None or cost > thresh:
            break
        used_i.add(i)
        used_j.add(j)
        row_idx.append(int(i))
        col_idx.append(int(j))
    return row_idx, col_idx


def ocr_global_assignment(expected: Dict[str, Any], barcode_text: str, pairs_ctx: List[Dict[str, str]], assign_thresh: float = 0.75) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    rows: List[Dict[str, Any]] = []
    summary = {"matched": 0, "mismatched": 0, "missing": 0}
    expected_items = [(k, "" if v is None else str(v)) for k, v in expected.items()]

    if not expected_items:
        return rows, summary

    C = build_cost_matrix(expected_items, pairs_ctx)

    if HAS_SCIPY and C and C[0]:
        try:
            import numpy as np  # type: ignore

            C_np = np.array(C, dtype=float)
            ri, cj = linear_sum_assignment(C_np)
            row_idx: List[int] = []
            col_idx: List[int] = []
            for i, j in zip(ri, cj):
                if C[i][j] <= assign_thresh:
                    row_idx.append(int(i))
                    col_idx.append(int(j))
        except Exception:
            row_idx, col_idx = greedy_assign(C, assign_thresh)
    else:
        row_idx, col_idx = greedy_assign(C, assign_thresh)

    assigned_map: Dict[int, int] = {int(i): int(j) for i, j in zip(row_idx, col_idx)}

    for i, (key, ocr_val_str) in enumerate(expected_items):
        if i in assigned_map:
            j = assigned_map[i]
            p = pairs_ctx[j]
            bc_label, bc_value = p["label"], p["value"]

            if equal_strict_or_flexible(ocr_val_str, bc_value):
                rows.append(
                    {
                        "key": key,
                        "ocr": ocr_val_str,
                        "barcode_label": bc_label,
                        "barcode_value": bc_value,
                        "status": "MATCH",
                        "context_label": bc_label,
                    }
                )
                summary["matched"] += 1
            else:
                rows.append(
                    {
                        "key": key,
                        "ocr": ocr_val_str,
                        "barcode_label": bc_label,
                        "barcode_value": bc_value,
                        "status": "MISMATCH",
                        "context_label": bc_label,
                    }
                )
                summary["mismatched"] += 1
        else:
            found = find_value_in_text_strict(ocr_val_str, barcode_text)
            if found:
                s, e, matched = found
                ls, le = find_line_bounds(barcode_text, s)
                line = barcode_text[ls:le]
                inferred = infer_label_on_line(line, (s - ls, e - ls))
                rows.append(
                    {
                        "key": key,
                        "ocr": ocr_val_str,
                        "barcode_label": inferred or "",
                        "barcode_value": matched,
                        "status": "MISMATCH",
                        "context_label": inferred or "",
                    }
                )
                summary["mismatched"] += 1
            else:
                rows.append(
                    {
                        "key": key,
                        "ocr": ocr_val_str,
                        "barcode_label": "",
                        "barcode_value": "",
                        "status": "MISSING",
                        "context_label": "",
                    }
                )
                summary["missing"] += 1

    return rows, summary


def library_remaining_to_list(
    lib_map: DefaultDict[Tuple[str, str], List[Dict[str, str]]], consumed_values: List[str]
) -> List[Dict[str, Any]]:
    def equals_any_consumed(val: str) -> bool:
        return any(equal_strict_or_flexible(val, mv) for mv in consumed_values)

    missed: List[Dict[str, Any]] = []
    for (_val_norm, cls), arr in lib_map.items():
        kept = [e for e in arr if not equals_any_consumed(e["value"])]
        if not kept:
            continue
        labels = list({e["label"] or "(unlabeled)" for e in kept})
        disp_val = kept[0]["value"]
        missed.append({"class": cls, "labels": labels, "value": disp_val, "count": len(kept)})

    order = {
        "alnum_long": 0,
        "truck": 1,
        "wh": 2,
        "rack": 3,
        "date": 4,
        "time": 5,
        "code_short": 6,
        "small_int": 7,
        "string": 8,
        "empty": 9,
    }
    missed.sort(key=lambda x: (order.get(x["class"], 99), x["value"]))
    return missed


def run_report(barcode_data: List[Dict[str, Any]], expected: Dict[str, Any]) -> Dict[str, Any]:
    barcode_text_blocks = [str(entry.get("text", "")) for entry in barcode_data if entry.get("text")]
    barcode_text = "\n".join(barcode_text_blocks)

    lib_map, lib_entries, labeled_pairs = build_barcode_library(barcode_text)

    rows, summary = ocr_global_assignment(expected, barcode_text, labeled_pairs)

    consumed_values: List[str] = []
    for r in rows:
        if r.get("barcode_value"):
            consumed_values.append(r["barcode_value"])

    missed = library_remaining_to_list(lib_map, consumed_values)

    return {
        "rows": rows,
        "summary": summary,
        "library": {
            "entries_count": len(lib_entries),
            "missed_by_ocr_count": len(missed),
            "missed_by_ocr": missed,
        },
        "barcode_text": barcode_text,
    }


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: barcode_ocr_match.py <barcode_json> <ocr_json>", file=sys.stderr)
        return 2

    barcode_path = Path(sys.argv[1])
    ocr_path = Path(sys.argv[2])

    try:
        barcode_data = json.loads(barcode_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(json.dumps({"error": f"Failed to load barcode JSON: {exc}"}))
        return 1

    try:
        expected = json.loads(ocr_path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(json.dumps({"error": f"Failed to load OCR JSON: {exc}"}))
        return 1

    if not isinstance(barcode_data, list):
        print(json.dumps({"error": "Barcode JSON must be a list"}))
        return 1
    if not isinstance(expected, dict):
        print(json.dumps({"error": "OCR JSON must be an object"}))
        return 1

    report = run_report(barcode_data, expected)
    print(json.dumps(to_jsonable(report), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
