#!/usr/bin/env python3
# Barcode_OCRStrict_Assignment_PATCH_v4.py
# - OCR-driven matching (right-side strict; flexible time/date)
# - Global one-to-one assignment (Hungarian if SciPy; else greedy)
# - General "colon-cell" parsing patch to avoid composite false pairs
# - Relaxed string intake by default (toggle with --strict-strings)
# - Debug mode dumps intermediates
# - JSON sanitizer converts numpy/pandas objects to plain Python (fixes int64 serialization)

import json, re, difflib, sys, csv, os
from typing import Dict, Any, List, Tuple, Optional, DefaultDict
from collections import defaultdict

# Try SciPy Hungarian; fall back to greedy if missing
try:
    from scipy.optimize import linear_sum_assignment
    HAS_SCIPY = True
except Exception:
    HAS_SCIPY = False

# ---- JSON sanitizer: convert numpy/pandas objects to plain Python ----
def to_jsonable(obj):
    """Recursively coerce numpy/pandas objects into JSON-serialisable primitives."""

    try:
        import numpy as np  # optional
        NP_AVAILABLE = True
    except Exception:
        NP_AVAILABLE = False

    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj

    if NP_AVAILABLE:
        import numpy as np
        if isinstance(obj, np.generic):
            return obj.item()
        if isinstance(obj, np.ndarray):
            return obj.tolist()

    try:
        import pandas as pd
        if isinstance(obj, pd.Timestamp):
            return obj.isoformat()
    except Exception:
        pass

    if isinstance(obj, dict):
        return {to_jsonable(k): to_jsonable(v) for (k, v) in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [to_jsonable(x) for x in obj]

    return str(obj)

# ---------- Regexes ----------
SEP_LINE = re.compile(r"^[-\s]{8,}$")

# Times
TIME_RX       = re.compile(r"\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\b", re.I)        # scan
FULL_TIME_RX  = re.compile(r"^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s*$", re.I)    # strict parse

# Dates: dd/mm/yyyy, mm/dd/yy, yyyy-mm-dd
DATE_RX1 = re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b")
DATE_RX2 = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
DATE_RX  = re.compile(DATE_RX1.pattern + r"|" + DATE_RX2.pattern)

# Common patterns
TRK_RX   = re.compile(r"\b(?:TRK|TRUCK)\s*[- ]?\d{2,6}\b", re.I)
WH_RX    = re.compile(r"\bWH-?\d{1,3}\b", re.I)
RACK_RX  = re.compile(r"\b(?:WH-?\d{1,3}|[A-Z]\d{2,3})\b", re.I)
ALNUM_LONG    = re.compile(r"(?=[A-Z0-9\-]*\d)[A-Z0-9\-]{8,}", re.I)   # long IDs / tracking
CODE_SHORT_RX = re.compile(r"(?=[A-Z0-9]*\d)[A-Z0-9\-]{5,12}", re.I)  # short codes, e.g., PLTP987
DIGIT_ONLY_RX = re.compile(r"^\d{1,4}$")

LABEL_COLON_RX = re.compile(r"([A-Za-z][A-Za-z0-9 /#\-\(\)]{1,32})\s*:\s*")
CELL_COLON_RX  = re.compile(r"^\s*[A-Za-z][A-Za-z0-9 /#\-\(\)]{1,32}\s*:\s*\S")

# ---------- Utilities ----------
def norm_text(s: str) -> str:
    """Collapse repeated whitespace and trim the ends."""

    return re.sub(r"\s+", " ", (s or "")).strip()

def norm_case_space(s: str) -> str:
    """Uppercase a string after whitespace normalization."""

    return norm_text(s).upper()

def norm_label(s: str) -> str:
    """Simplify labels to lowercase alphanumeric tokens for comparison."""

    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()

def labels_match(ocr_key: str, lbl: str) -> float:
    """Alias-free label similarity: exact normalized equality => 1.0; else fuzzy ratio."""
    nk = norm_label(ocr_key)
    nl = norm_label(lbl)
    if not nk or not nl:
        return 0.0
    if nk == nl:
        return 1.0
    return difflib.SequenceMatcher(None, nk, nl).ratio()

def get_lines(text: str) -> List[str]:
    """Split text into individual lines while normalising newlines."""

    return text.replace("\r\n", "\n").replace("\r", "\n").split("\n")

def find_line_bounds(text: str, idx: int) -> Tuple[int, int]:
    """Return the start/end offsets for the line containing ``idx``."""

    start = text.rfind("\n", 0, idx) + 1
    end = text.find("\n", idx)
    end = len(text) if end == -1 else end
    return start, end

# ---------- Time & Date normalization ----------
def norm_time_tuple_full(s: str) -> Optional[Tuple[int,int,int,Optional[str]]]:
    """Parse strictly as a *whole* time (rejects 'AMPM' or extra chars)."""
    if not s:
        return None
    m = FULL_TIME_RX.fullmatch(s)
    if not m:
        return None
    hh = int(m.group(1)); mm = int(m.group(2)); ss = int(m.group(3) or 0)
    mer = (m.group(4) or "").upper() or None
    h24 = hh
    if mer == "PM" and hh != 12: h24 = hh + 12
    if mer == "AM" and hh == 12: h24 = 0
    return (h24, mm, ss, mer)

def times_equal_flexible(ocr_val: str, bc_val: str) -> bool:
    """Compare times while ignoring seconds and respecting AM/PM context."""

    A = norm_time_tuple_full(ocr_val)
    B = norm_time_tuple_full(bc_val)
    if not A or not B: return False
    ah, am, _, amer = A
    bh, bm, _, bmer = B
    if (amer is not None) or (bmer is not None):
        if amer is None or bmer is None: return False
        if amer != bmer: return False
    return ah == bh and am == bm  # flexible seconds

def norm_date_tuple(s: str) -> Optional[Tuple[int,int,int]]:
    """Coerce supported date strings to a canonical tuple."""

    if not s: return None
    m2 = DATE_RX2.search(s)
    if m2:
        y, mo, d = int(m2.group(1)), int(m2.group(2)), int(m2.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31: return (y, mo, d)
        return None
    m1 = DATE_RX1.search(s)
    if not m1: return None
    a, b, y = int(m1.group(1)), int(m1.group(2)), int(m1.group(3))
    if a > 12 and b <= 12: d, mo = a, b
    else: mo, d = a, b
    if 1 <= mo <= 12 and 1 <= d <= 31: return (y, mo, d)
    return None

def dates_equal_flexible(ocr_val: str, bc_val: str) -> bool:
    """Check if two date strings resolve to the same calendar day."""

    A = norm_date_tuple(ocr_val)
    B = norm_date_tuple(bc_val)
    return (A is not None) and (B is not None) and (A == B)

# ---------- Token-anchored strict matching ----------
ALNUM = r"[A-Za-z0-9]"

def anchored_value_regex(value: str) -> re.Pattern:
    """
    Strict match except whitespace:
      - replace spaces with \s+
      - require NO letter/digit right before or after the value (token boundaries)
    => prevents 'WH-0' matching inside 'WH-07'
    """
    s = value or ""
    esc = re.escape(s).replace(r"\ ", r"\s+")
    prefix = r"(?<!%s)" % ALNUM if re.match(ALNUM, s) else ""
    suffix = r"(?!%s)" % ALNUM if re.search(ALNUM + r"$", s) else ""
    return re.compile(prefix + esc + suffix, re.I)

def find_value_in_text_strict(value: str, text: str) -> Optional[Tuple[int,int,str]]:
    """Return the span where ``value`` appears in ``text`` with token boundaries."""

    if not value: return None
    pat = anchored_value_regex(value)
    m = pat.search(text)
    if m:
        return (m.start(), m.end(), m.group(0))
    return None

def value_is_substring_token(needle: str, hay: str) -> bool:
    """Heuristically treat ``needle`` as present only if found as its own token."""

    if not needle or not hay:
        return False
    pat = anchored_value_regex(needle)
    return bool(pat.search(hay))

# ---------- Helpers ----------
def looks_valueish(tokens: List[str]) -> bool:
    """Return True when tokens include numbers, dates, or times indicating data cells."""

    for t in tokens:
        if TIME_RX.search(t) or DATE_RX.search(t) or re.search(r"\d", t):
            return True
    return False

def split_fields(line: str) -> List[str]:
    """Split a row into fields using tab or double-space separators."""

    if "\t" in line:
        parts = [p for p in re.split(r"\t+", line) if p.strip()]
    else:
        parts = [p for p in re.split(r"\s{2,}", line) if p.strip()]
    return [p.strip() for p in parts]

def classify_value(v: str) -> str:
    """Categorise extracted values so assignment logic can weight matches."""

    if not v or not v.strip(): return "empty"
    if TIME_RX.search(v): return "time"
    if DATE_RX.search(v): return "date"
    if TRK_RX.search(v):  return "truck"
    if WH_RX.search(v):   return "wh"
    if RACK_RX.search(v): return "rack"
    if ALNUM_LONG.search(v): return "alnum_long"
    if CODE_SHORT_RX.search(v): return "code_short"
    if DIGIT_ONLY_RX.match(v):  return "small_int"
    return "string"

def equal_strict_or_flexible(ocr_val: str, bc_val: str) -> bool:
    """Determine if OCR and barcode values align exactly or via domain rules."""

    o = norm_case_space(ocr_val)
    b = norm_case_space(bc_val)
    if o == b: return True
    if FULL_TIME_RX.fullmatch(ocr_val) and FULL_TIME_RX.fullmatch(bc_val):
        return times_equal_flexible(ocr_val, bc_val)
    if DATE_RX.search(ocr_val) and DATE_RX.search(bc_val):
        return dates_equal_flexible(ocr_val, bc_val)
    return False

# ---------- Context inference (visuals) ----------
def infer_label_on_line(line: str, match_span: Tuple[int,int]) -> Optional[str]:
    """Infer which label text precedes a matched value on the same OCR line."""

    mstart, _ = match_span
    last = None
    for m in LABEL_COLON_RX.finditer(line):
        if m.end() <= mstart: last = m
        else: break
    if last:
        return last.group(1).strip()
    toks = line.split("\t")
    acc = 0
    for i, t in enumerate(toks):
        seg_end = acc + len(t)
        if acc <= mstart <= seg_end:
            if i > 0 and toks[i-1].strip():
                return toks[i-1].strip()
            break
        acc = seg_end + 1
    parts = re.split(r"\s{2,}", line)
    acc = 0
    for i, p in enumerate(parts):
        seg_end = acc + len(p)
        if acc <= mstart <= seg_end:
            if i > 0 and parts[i-1].strip():
                return parts[i-1].strip()
            break
        acc = seg_end + 2
    return None

# ---------- Parse pairs for context (with general colon-cell patch) ----------
def _is_colon_cell(s: str) -> bool:
    """Return True when a token looks like a ``Label: Value`` cell."""

    return bool(CELL_COLON_RX.match(s or ""))

def parse_pairs_for_context(text: str) -> List[Dict[str, str]]:
    """Extract candidate label/value pairs using heuristics for tables and forms."""

    pairs: List[Dict[str,str]] = []
    lines = get_lines(text)
    i = 0
    while i < len(lines):
        ln = lines[i].strip()
        if not ln or SEP_LINE.match(ln):
            i += 1; continue

        # Multiple Label: Value on the same line
        for m in re.finditer(
            r"([A-Za-z][A-Za-z0-9 /#\-\(\)]{1,32})\s*:\s*([^\t]+?)(?=(?:\s{2,}|\t+|$|[A-Za-z][A-Za-z0-9 /#\-\(\)]{1,32}\s*:))",
            ln
        ):
            lbl = m.group(1).strip()
            val = m.group(2).strip()
            if val: pairs.append({"label": lbl, "value": val})

        # Table-like tabs / spacing
        toks = split_fields(ln)
        n = len(toks)
        if n >= 2:
            if n == 2:
                # If BOTH cells are "Label: Value", skip cross pair; they were extracted above.
                if _is_colon_cell(toks[0]) and _is_colon_cell(toks[1]):
                    i += 1; continue
                # Otherwise keep as candidate; filtered later in build_barcode_library
                pairs.append({"label": toks[0], "value": toks[1]})
                i += 1; continue

            # Header row followed by values row
            j = i + 1
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines):
                nxt = split_fields(lines[j])
                if len(nxt) == n and looks_valueish(nxt) and not looks_valueish(toks):
                    for a, b in zip(toks, nxt):
                        pairs.append({"label": a, "value": b})
                    i = j + 1; continue

            # Even-sized label-value segments on a single line
            if n % 2 == 0 and looks_valueish(toks):
                # If every token is a colon-cell, split each cell into its own pair
                if all(_is_colon_cell(t) for t in toks):
                    for cell in toks:
                        m = re.match(r"^\s*([A-Za-z][A-Za-z0-9 /#\-\(\)]{1,32})\s*:\s*(.+)$", cell)
                        if m:
                            pairs.append({"label": m.group(1).strip(), "value": m.group(2).strip()})
                    i += 1; continue

                # Fallback: pair (0,1), (2,3), ...
                for k in range(0, n, 2):
                    if k+1 < n:
                        pairs.append({"label": toks[k], "value": toks[k+1]})
                i += 1; continue

        i += 1

    # Dedupe
    seen, dedup = set(), []
    for p in pairs:
        key = (p["label"], p["value"])
        if key not in seen:
            dedup.append(p); seen.add(key)
    return dedup

# ---------- Build BARCODE LIBRARY (for “missed” reporting) ----------
def build_barcode_library(text: str, harvest_raw: bool, strict_strings: bool, debug: bool, debug_dir: str):
    """Create barcode candidates, optionally dumping intermediate debugging files."""

    entries: List[Dict[str,str]] = []
    labeled_pairs = parse_pairs_for_context(text)

    if debug:
        os.makedirs(debug_dir, exist_ok=True)
        with open(os.path.join(debug_dir, "barcode_text.txt"), "w", encoding="utf-8") as f:
            f.write(text)
        with open(os.path.join(debug_dir, "pairs_raw.json"), "w", encoding="utf-8") as f:
            json.dump(to_jsonable(labeled_pairs), f, indent=2, ensure_ascii=False)

    present_keys = set()  # (norm_value, class)
    skipped: List[Dict[str,str]] = []

    for p in labeled_pairs:
        lbl, val = p["label"].strip(), p["value"].strip()
        if not val:
            skipped.append({"label": lbl, "value": val, "reason": "empty_value"}); continue

        vclass = classify_value(val)
        keep = False
        reason = ""

        # Always keep structured types
        if vclass in ("time","date","truck","wh","rack","alnum_long","code_short"):
            keep = True; reason = "typed_keep"

        elif vclass == "small_int":
            keep = bool(re.search(r"[A-Za-z]", lbl))
            reason = "small_int_keep" if keep else "small_int_drop"

        else:
            # STRING values:
            if ":" in lbl:
                keep = True; reason = "label_colon"
            else:
                # RELAXED mode: accept 2-col lines with label-like + multiword/title-like value
                if not strict_strings:
                    if re.fullmatch(r"[A-Za-z][A-Za-z0-9 /#\-\(\)]{1,32}", lbl) and len(val) >= 4:
                        if " " in val or re.search(r"[A-Z][a-z]+", val):
                            keep = True; reason = "relaxed_string_keep"
                # STRICT mode: require label-like + value not label-like
                if not keep:
                    if re.fullmatch(r"[A-Za-z][A-Za-z0-9 /#\-\(\)]{1,32}", lbl):
                        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9 /#\-\(\)]{1,32}", val):
                            keep = True; reason = "strict_string_keep"

        if keep:
            entries.append({"label": lbl, "value": val, "class": vclass})
            present_keys.add((norm_case_space(val), vclass))
        else:
            skipped.append({"label": lbl, "value": val, "reason": reason or "string_drop"})

    # Raw harvest for standalone tokens (helps when pair parsing fails)
    if harvest_raw:
        raw = text
        for m in ALNUM_LONG.finditer(raw):
            v, cls = m.group(0), "alnum_long"; key = (norm_case_space(v), cls)
            if key not in present_keys:
                entries.append({"label": "", "value": v, "class": cls}); present_keys.add(key)
        for m in TRK_RX.finditer(raw):
            v, cls = m.group(0), "truck"; key = (norm_case_space(v), cls)
            if key not in present_keys:
                entries.append({"label": "Truck", "value": v, "class": cls}); present_keys.add(key)
        for m in WH_RX.finditer(raw):
            v, cls = m.group(0), "wh"; key = (norm_case_space(v), cls)
            if key not in present_keys:
                entries.append({"label": "WH", "value": v, "class": cls}); present_keys.add(key)
        for m in TIME_RX.finditer(raw):
            v, cls = m.group(0), "time"; key = (norm_case_space(v), cls)
            if key not in present_keys:
                entries.append({"label": "Time", "value": v, "class": cls}); present_keys.add(key)
        for m in DATE_RX.finditer(raw):
            v, cls = m.group(0), "date"; key = (norm_case_space(v), cls)
            if key not in present_keys:
                entries.append({"label": "Date", "value": v, "class": cls}); present_keys.add(key)

    if debug:
        with open(os.path.join(debug_dir, "pairs_kept.json"), "w", encoding="utf-8") as f:
            json.dump(to_jsonable(entries), f, indent=2, ensure_ascii=False)
        with open(os.path.join(debug_dir, "pairs_skipped.json"), "w", encoding="utf-8") as f:
            json.dump(to_jsonable(skipped), f, indent=2, ensure_ascii=False)

    lib_map: DefaultDict[Tuple[str,str], List[Dict[str,str]]] = defaultdict(list)
    for e in entries:
        lib_map[(norm_case_space(e["value"]), e["class"])].append(e)

    return lib_map, entries, labeled_pairs

# ---------- Assignment cost model ----------
def pair_cost(ocr_key: str, ocr_val: str, p: Dict[str,str]) -> float:
    """
    Lower = better.
    Combines: label similarity (heavy), value equality/equivalence, and type compatibility.
    Right side (barcode) remains strict; time/date equivalence allowed.
    """
    lab_sim = labels_match(ocr_key, p['label'])
    lab_cost = 1.0 - lab_sim

    if equal_strict_or_flexible(ocr_val, p['value']):
        v_cost = 0.0
    elif value_is_substring_token(ocr_val, p['value']):
        v_cost = 0.75
    else:
        v_cost = 1.0

    o_cls = classify_value(ocr_val)
    p_cls = classify_value(p['value'])
    same_time = FULL_TIME_RX.search(ocr_val) and FULL_TIME_RX.search(p['value'])
    same_date = DATE_RX.search(ocr_val) and DATE_RX.search(p['value'])
    t_pen = 0.0 if (o_cls == p_cls or same_time or same_date) else 0.25

    return 0.6*lab_cost + 0.35*v_cost + 0.05*t_pen

def build_cost_matrix(expected_items: List[Tuple[str,str]], pairs: List[Dict[str,str]]) -> List[List[float]]:
    """Compute the pairwise costs between expected OCR entries and barcode pairs."""

    M, N = len(expected_items), len(pairs)
    C = [[1.5 for _ in range(N)] for _ in range(M)]
    for i, (k, v) in enumerate(expected_items):
        sv = "" if v is None else str(v)
        for j, p in enumerate(pairs):
            C[i][j] = pair_cost(k, sv, p)
    return C

def greedy_assign(C: List[List[float]], thresh: float) -> Tuple[List[int], List[int]]:
    """Greedy approximation for assignment when Hungarian solver is unavailable."""

    M, N = len(C), len(C[0]) if C else 0
    used_i, used_j = set(), set()
    row_idx, col_idx = [], []
    while True:
        best = (None, None, float('inf'))
        for i in range(M):
            if i in used_i: continue
            for j in range(N):
                if j in used_j: continue
                cost = C[i][j]
                if cost < best[2]:
                    best = (i, j, cost)
        i, j, cost = best
        if i is None or cost > thresh:
            break
        used_i.add(i); used_j.add(j)
        row_idx.append(i); col_idx.append(j)
    return row_idx, col_idx

# ---------- OCR-driven with global assignment ----------
def ocr_global_assignment(expected: Dict[str, Any], barcode_text: str,
                          pairs_ctx: List[Dict[str,str]],
                          assign_thresh: float,
                          debug: bool, debug_dir: str):
    """Assign OCR expectation rows to barcode-derived pairs using global optimisation."""

    rows = []
    summary = {"matched": 0, "mismatched": 0, "missing": 0}
    expected_items = [(k, "" if v is None else str(v)) for k, v in expected.items()]

    C = build_cost_matrix(expected_items, pairs_ctx)

    if debug:
        os.makedirs(debug_dir, exist_ok=True)
        with open(os.path.join(debug_dir, "assignment_rows_expected.json"), "w", encoding="utf-8") as f:
            json.dump(to_jsonable([{"key": k, "value": v} for k, v in expected_items]), f, indent=2, ensure_ascii=False)
        with open(os.path.join(debug_dir, "assignment_cols_pairs.json"), "w", encoding="utf-8") as f:
            json.dump(to_jsonable(pairs_ctx), f, indent=2, ensure_ascii=False)
        with open(os.path.join(debug_dir, "cost_matrix.csv"), "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            for row in C:
                w.writerow([f"{x:.4f}" for x in row])

    if HAS_SCIPY and C and C[0]:
        try:
            import numpy as np
        except Exception:
            np = None
        if np is not None:
            C_np = np.array(C, dtype=float)
            ri, cj = linear_sum_assignment(C_np)
            row_idx, col_idx = [], []
            for i, j in zip(ri, cj):
                if C[i][j] <= assign_thresh:
                    row_idx.append(int(i)); col_idx.append(int(j))
        else:
            row_idx, col_idx = greedy_assign(C, assign_thresh)
    else:
        row_idx, col_idx = greedy_assign(C, assign_thresh)

    assigned_map: Dict[int, int] = {int(i): int(j) for i, j in zip(row_idx, col_idx)}

    if debug:
        with open(os.path.join(debug_dir, "assignment_selected.json"), "w", encoding="utf-8") as f:
            sel = []
            for i, j in zip(row_idx, col_idx):
                sel.append({
                    "expected_index": int(i),
                    "barcode_pair_index": int(j),
                    "expected": {"key": expected_items[i][0], "value": expected_items[i][1]},
                    "barcode_pair": pairs_ctx[j],
                    "cost": C[i][j]
                })
            json.dump(to_jsonable(sel), f, indent=2, ensure_ascii=False)

    for i, (key, ocr_val_str) in enumerate(expected_items):
        if i in assigned_map:
            j = assigned_map[i]
            p = pairs_ctx[j]
            bc_label, bc_value = p['label'], p['value']

            if equal_strict_or_flexible(ocr_val_str, bc_value):
                rows.append({"key": key, "ocr": ocr_val_str,
                             "barcode_label": bc_label, "barcode_value": bc_value,
                             "status": "MATCH", "context_label": bc_label})
                summary["matched"] += 1
            elif value_is_substring_token(ocr_val_str, bc_value):
                rows.append({"key": key, "ocr": ocr_val_str,
                             "barcode_label": bc_label, "barcode_value": bc_value,
                             "status": "MISMATCH", "context_label": bc_label})
                summary["mismatched"] += 1
            else:
                rows.append({"key": key, "ocr": ocr_val_str,
                             "barcode_label": bc_label, "barcode_value": bc_value,
                             "status": "MISMATCH", "context_label": bc_label})
                summary["mismatched"] += 1
        else:
            found = find_value_in_text_strict(ocr_val_str, barcode_text)
            if found:
                s, e, matched = found
                ls, le = find_line_bounds(barcode_text, s)
                line = barcode_text[ls:le]
                inferred = infer_label_on_line(line, (s - ls, e - ls))
                rows.append({"key": key, "ocr": ocr_val_str,
                             "barcode_label": inferred or key, "barcode_value": matched,
                             "status": "MISMATCH", "context_label": inferred or ""})
                summary["mismatched"] += 1
            else:
                rows.append({"key": key, "ocr": ocr_val_str,
                             "barcode_label": "", "barcode_value": "",
                             "status": "MISSING", "context_label": ""})
                summary["missing"] += 1

    return rows, summary

# ---------- “Missed by OCR” from library minus consumed ----------
def library_remaining_to_list(lib_map: DefaultDict[Tuple[str,str], List[Dict[str,str]]],
                              consumed_values: List[str]) -> List[Dict[str,str]]:
    """Summarise unmatched barcode library entries for reporting."""

    def equals_any_consumed(val: str) -> bool:
        return any(equal_strict_or_flexible(val, mv) for mv in consumed_values)

    missed = []
    for (val_norm, cls), arr in lib_map.items():
        kept = [e for e in arr if not equals_any_consumed(e["value"])]
        if not kept:
            continue
        labels = list({e["label"] or "(unlabeled)" for e in kept})
        disp_val = kept[0]["value"]
        missed.append({"class": cls, "labels": labels, "value": disp_val, "count": len(kept)})

    order = {"alnum_long":0, "truck":1, "wh":2, "rack":3, "date":4, "time":5, "code_short":6, "small_int":7, "string":8, "empty":9}
    missed.sort(key=lambda x: (order.get(x["class"], 99), x["value"]))
    return missed

# ---------- Visuals ----------
def build_visual_text(rows: List[Dict[str, Any]], missed_by_ocr: List[Dict[str,Any]]) -> str:
    """Render a plaintext comparison and appendix for missed barcode values."""

    out = []
    for r in rows:
        ctx = f' (ctx={r["context_label"]})' if r.get("context_label") else ""
        out.append(
            f'OCR: "{r["key"]}": "{r["ocr"]}",  '
            f'Barcode: "{r["barcode_label"]}": "{r["barcode_value"]}"  '
            f'=> {r["status"]}{ctx}'
        )
    if missed_by_ocr:
        out.append("\n---\nBARCODE-ONLY (missed by OCR):")
        for m in missed_by_ocr:
            labels = ", ".join(m["labels"])
            suffix = f" x{m['count']}" if m["count"] > 1 else ""
            out.append(f'- [{m["class"]}] {labels}: "{m["value"]}"{suffix}')
    return "\n".join(out)

def build_visual_md(rows: List[Dict[str, Any]], missed_by_ocr: List[Dict[str,Any]]) -> str:
    """Produce Markdown tables summarising matches and misses."""

    lines = ["| Field | OCR Value | Barcode Value | Result | Context Label |",
             "|---|---|---|---|---|"]
    for r in rows:
        lines.append(
            f'| {r["key"]} | {r["ocr"]} | {r.get("barcode_value", "")} | {r["status"]} | {r.get("context_label", "")} |'
        )
    if missed_by_ocr:
        lines.append("\n**BARCODE-ONLY (missed by OCR):**")
        lines.append("| Class | Labels | Value | Count |")
        lines.append("|---|---|---|---|")
        for m in missed_by_ocr:
            labels = ", ".join(m["labels"])
            lines.append(f'| {m["class"]} | {labels} | {m["value"]} | {m["count"]} |')
    return "\n".join(lines)

# ---------- Main ----------
def main():
    """Entry point: run OCR-to-barcode matching and emit JSON/visual reports."""

    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("barcode_json", help="ZXing output JSON (list with {'text': ...})")
    ap.add_argument("expected_json", help="OCR JSON (vendor-specific keys)")
    ap.add_argument("--out", help="Write detailed JSON report here")
    ap.add_argument("--visual-out", help="Write side-by-side TEXT here")
    ap.add_argument("--visual-md", help="Write side-by-side Markdown here")
    ap.add_argument("--no-raw", action="store_true", help="Disable raw-token harvest for the barcode library")
    ap.add_argument("--strict-strings", action="store_true", help="Be strict with string pairs (default is relaxed for recall)")
    ap.add_argument("--assign-thresh", type=float, default=0.75, help="Assignment acceptance threshold (lower=pickier)")
    ap.add_argument("--debug", action="store_true", help="Dump debug intermediates to ./debug_out")
    ap.add_argument("--debug-dir", default="debug_out", help="Directory for debug dumps")
    args = ap.parse_args()

    with open(args.barcode_json, "r", encoding="utf-8") as f:
        barcode_data = json.load(f)
    with open(args.expected_json, "r", encoding="utf-8") as f:
        expected = json.load(f)

    if not isinstance(barcode_data, list) or not barcode_data:
        raise ValueError("barcode_output.json must be a non-empty list with an object containing 'text'")
    barcode_text = barcode_data[0].get("text", "")

    # Build library (for missed detection) and get labeled pairs (for assignment)
    lib_map, lib_entries, labeled_pairs = build_barcode_library(
        barcode_text,
        harvest_raw=not args.no_raw,
        strict_strings=args.strict_strings,
        debug=args.debug,
        debug_dir=args.debug_dir
    )

    # Run OCR-driven global assignment on labeled pairs
    rows, summary = ocr_global_assignment(
        expected, barcode_text, labeled_pairs,
        assign_thresh=args.assign_thresh,
        debug=args.debug, debug_dir=args.debug_dir
    )

    # Consume values used in MATCH or aligned MISMATCH
    consumed_values: List[str] = []
    for r in rows:
        if r.get("status") in ("MATCH", "MISMATCH") and r.get("barcode_label"):
            val = r.get("barcode_value", "")
            if val:
                consumed_values.append(val)

    # Remaining lib entries => “missed by OCR”
    missed = library_remaining_to_list(lib_map, consumed_values)

    visual_txt = build_visual_text(rows, missed)
    visual_md  = build_visual_md(rows, missed)

    report = {
        "mode": "ocr-driven + global-assignment (alias-free, relaxed-strings={})".format(not args.strict_strings),
        "hungarian_available": HAS_SCIPY,
        "assignment_threshold": args.assign_thresh,
        "barcode_metadata": {
            "format": barcode_data[0].get("format"),
            "symbology_identifier": barcode_data[0].get("symbology_identifier"),
            "position": barcode_data[0].get("position"),
        },
        "results": rows,
        "summary": summary,
        "library": {
            "entries_count": len(lib_entries),
            "missed_by_ocr_count": len(missed),
            "missed_by_ocr": missed
        },
        "visual": {"text": visual_txt, "markdown": visual_md}
    }

    if args.debug:
        with open(os.path.join(args.debug_dir, "report_preview.json"), "w", encoding="utf-8") as f:
            json.dump(to_jsonable(report), f, indent=2, ensure_ascii=False)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(to_jsonable(report), f, indent=2, ensure_ascii=False)
    if args.visual_out:
        with open(args.visual_out, "w", encoding="utf-8") as f:
            f.write(visual_txt + "\n")
    if args.visual_md:
        with open(args.visual_md, "w", encoding="utf-8") as f:
            f.write(visual_md + "\n")

    print(json.dumps(to_jsonable(report), indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
