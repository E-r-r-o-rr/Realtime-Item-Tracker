"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { FloorMapViewer } from "@/components/scanner/floor-map-viewer";

interface LiveRecord {
  destination: string;
  itemName: string;
  trackingId: string;
  truckNumber: string;
  shipDate: string;
  expectedDepartureTime: string;
  origin: string;
}

interface ApiLiveBufferRecord {
  id: number;
  destination: string;
  itemName: string;
  trackingId: string;
  truckNumber: string;
  shipDate: string;
  expectedDepartureTime: string;
  originLocation: string;
  lastSyncedAt: string;
}

interface KvPairs {
  [key: string]: any;
}

interface BarcodeValidation {
  matches: boolean | null;
  status: "match" | "mismatch" | "no_barcode" | "missing_item_code";
  message: string;
  comparedValue?: string;
}

type ValidationStatus = "match" | "mismatch" | "no_barcode" | "missing_item_code";

interface ApiValidation {
  status: ValidationStatus;
  message: string;
  comparedValue?: string;
}

interface ApiOcrResponse {
  kv?: KvPairs;
  barcodes?: string[];
  barcodeWarnings?: string[];
  validation?: ApiValidation;
  providerInfo?: ProviderInfo;
  error?: string;
}

interface ApiHistoryEntry {
  id: number;
  scanId: string;
  destination: string;
  itemName: string;
  trackingId: string;
  truckNumber: string;
  shipDate: string;
  expectedDepartureTime: string;
  originLocation: string;
  recordedAt: string;
}

type ProviderMode = "remote" | "local";

interface ProviderInfo {
  mode: ProviderMode;
  providerType?: string;
  modelId?: string;
  baseUrl?: string;
}

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  "openai-compatible": "OpenAI-compatible",
  huggingface: "Hugging Face Inference",
  "generic-http": "Generic HTTP",
  local: "Local OCR pipeline",
};

const PERSISTED_STATE_KEY = "scanner.dashboard.ui_state.v1";
const DEFAULT_REFRESH_MS = 300_000;
const REFRESH_INTERVAL_OPTIONS: { label: string; value: number }[] = [
  { label: "Every 30 seconds", value: 30_000 },
  { label: "Every 1 minute", value: 60_000 },
  { label: "Every 5 minutes", value: 300_000 },
];

const trimString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const DEFAULT_SCAN_ERROR_MESSAGE = "Error scanning document.";

const parseErrorPayload = (raw: string): string => {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const asRecord = parsed as Record<string, unknown>;
      const errorMessage = asRecord.error;
      if (typeof errorMessage === "string" && errorMessage.trim()) {
        return errorMessage.trim();
      }
      const message = asRecord.message;
      if (typeof message === "string" && message.trim()) {
        return message.trim();
      }
    }
  } catch (error) {
    // Ignore JSON parse failures and fall back to the raw string
  }
  return trimmed;
};

const formatStatusError = (error: unknown): string => {
  if (!error) return DEFAULT_SCAN_ERROR_MESSAGE;

  if (error instanceof Error) {
    const parsed = parseErrorPayload(error.message);
    if (parsed) return parsed;
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause && cause !== error) {
      const causeMessage = formatStatusError(cause);
      if (causeMessage && causeMessage !== DEFAULT_SCAN_ERROR_MESSAGE) {
        return causeMessage;
      }
    }
  }

  if (typeof error === "string") {
    const parsed = parseErrorPayload(error);
    if (parsed) return parsed;
  }

  if (error && typeof (error as { message?: unknown }).message === "string") {
    const parsed = parseErrorPayload((error as { message: string }).message);
    if (parsed) return parsed;
  }

  return DEFAULT_SCAN_ERROR_MESSAGE;
};

const sanitizeProviderInfo = (value: unknown): ProviderInfo | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const rawMode = trimString(raw.mode);
  const normalizedMode = rawMode === "remote" || rawMode === "local" ? (rawMode as ProviderMode) : null;
  if (!normalizedMode) return null;

  return {
    mode: normalizedMode,
    providerType: trimString(raw.providerType),
    modelId: trimString(raw.modelId),
    baseUrl: trimString(raw.baseUrl),
  };
};

const describeProviderType = (info: ProviderInfo): string => {
  if (info.mode === "local") {
    return PROVIDER_TYPE_LABELS.local;
  }
  if (info.providerType && PROVIDER_TYPE_LABELS[info.providerType]) {
    return PROVIDER_TYPE_LABELS[info.providerType];
  }
  return info.providerType ? info.providerType : "Remote provider";
};

const describeProviderLink = (info: ProviderInfo): { label: string; href?: string } => {
  if (info.mode === "local") {
    return { label: "Local pipeline" };
  }
  const base = info.baseUrl?.trim();
  if (!base) {
    if (info.providerType === "huggingface") {
      return { label: "https://router.huggingface.co", href: "https://router.huggingface.co" };
    }
    return { label: "No endpoint configured" };
  }
  const href = /^https?:\/\//i.test(base) ? base : undefined;
  return { label: base, href };
};

const toClientValidation = (v?: ApiValidation): BarcodeValidation | null => {
  if (!v) return null;
  return {
    matches: v.status === "match",
    status: v.status,
    message: v.message,
    comparedValue: v.comparedValue,
  };
};

const normalizeKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const normalizeForSearch = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeAlphanumeric = (value: string): string => value.replace(/[^a-z0-9]/gi, "").toLowerCase();

const BARCODE_FIELD_TITLES = [
  "Product Name",
  "Truck ID",
  "Date",
  "Current Warehouse ID",
  "Destination Warehouse ID",
  "Estimated Departure Time",
  "Estimated Arrival Time",
  "Loading Dock ID",
  "Shipping Dock ID",
  "Loading Bay",
  "Priority Class",
  "Order ID",
  "Loading Time",
  "Loading Priority",
  "Stow Position",
  "Order Reference",
  "Shipping Carrier",
];

const PREFERRED_ID_KEYS = [
  "order_id",
  "orderid",
  "tracking_id",
  "trackingid",
  "order_reference",
  "orderreference",
];

const ID_LIKE_SET = new Set(
  ["order_id", "orderid", "tracking_id", "trackingid", "item_code", "itemcode", "order_reference", "orderreference"].map(
    normalizeKey,
  ),
);

const COMPACT_BARCODE_KEYS = new Set(
  [
    "order_id",
    "orderid",
    "tracking_id",
    "trackingid",
    "truck_id",
    "truckid",
    "truck_number",
    "trucknumber",
    "destinationwarehouseid",
    "currentwarehouseid",
    "shippingdockid",
    "loadingdockid",
    "loadingbay",
    "stowposition",
    "orderreference",
  ].map(normalizeKey),
);

type ParsedTime = { hour24: number; minute: number; second: number; hadSeconds: boolean };

const parseTime = (value: string): ParsedTime | null => {
  const match = value
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*([ap]m)?$/);
  if (!match) return null;
  let hour = parseInt(match[1] ?? "", 10);
  const minute = parseInt(match[2] ?? "0", 10);
  const second = parseInt(match[3] ?? "0", 10);
  if (Number.isNaN(hour) || Number.isNaN(minute) || Number.isNaN(second)) return null;
  const meridiem = match[4];
  if (meridiem) {
    const isPm = meridiem === "pm";
    if (isPm && hour < 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
  }
  hour = hour % 24;
  return { hour24: hour, minute, second, hadSeconds: Boolean(match[3]) };
};

const formatTimeForDisplay = (parts: ParsedTime): string => {
  let hour = parts.hour24 % 12;
  if (hour === 0) hour = 12;
  const meridiem = parts.hour24 >= 12 ? "PM" : "AM";
  const minute = parts.minute.toString().padStart(2, "0");
  const includeSeconds = parts.hadSeconds || parts.second !== 0;
  const second = parts.second.toString().padStart(2, "0");
  return `${hour}:${minute}${includeSeconds ? `:${second}` : ""} ${meridiem}`;
};

const normalizeTimeForComparison = (parts: ParsedTime): string => {
  const hour = parts.hour24.toString().padStart(2, "0");
  const minute = parts.minute.toString().padStart(2, "0");
  const second = parts.second.toString().padStart(2, "0");
  return `${hour}:${minute}:${second}`;
};

type ParsedDate = { year: number; month: number; day: number };

const parseDate = (value: string): ParsedDate | null => {
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const year = parseInt(iso[1], 10);
    const month = parseInt(iso[2], 10);
    const day = parseInt(iso[3], 10);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
    return { year, month, day };
  }
  const slash = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slash) {
    let year = parseInt(slash[3], 10);
    const month = parseInt(slash[1], 10);
    const day = parseInt(slash[2], 10);
    if (slash[3].length === 2) year += year >= 70 ? 1900 : 2000;
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
    return { year, month, day };
  }
  return null;
};

const formatDateForDisplay = (parts: ParsedDate): string => {
  const month = parts.month.toString().padStart(2, "0");
  const day = parts.day.toString().padStart(2, "0");
  return `${month}/${day}/${parts.year}`;
};

const normalizeDateForComparison = (parts: ParsedDate): string => {
  const month = parts.month.toString().padStart(2, "0");
  const day = parts.day.toString().padStart(2, "0");
  return `${parts.year.toString().padStart(4, "0")}-${month}-${day}`;
};

const OCR_TO_BARCODE_KEY: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  const set = (aliases: string[], barcodeTitle: string) => {
    const nk = normalizeKey(barcodeTitle);
    aliases.forEach((a) => (m[normalizeKey(a)] = nk));
  };

  set(["Product Name", "Item Name", "product_name", "product", "item"], "Product Name");
  set(["Order ID", "Tracking ID", "tracking_id", "order_id"], "Order ID");
  set(["Truck Number", "Truck ID", "truck_number", "truck_no", "truck"], "Truck ID");
  set(["Ship Date", "Date", "shipping_date"], "Date");
  set(["Origin", "Origin (Origin Warehouse)", "Current Warehouse ID", "origin_warehouse"], "Current Warehouse ID");
  set(["Destination", "Destination Warehouse ID", "destinationwarehouseid"], "Destination Warehouse ID");
  set(
    ["Expected Departure Time", "Estimated Departure Time", "departure_time", "expected_departure_time"],
    "Estimated Departure Time",
  );
  set(["Estimated Arrival Time", "arrival_time"], "Estimated Arrival Time");
  set(["Shipping Dock ID", "Loading Dock ID", "dock", "dock_id"], "Shipping Dock ID");
  set(["Loading Bay"], "Loading Bay");
  set(["Priority Class"], "Priority Class");
  set(["Loading Time"], "Loading Time");
  set(["Loading Priority"], "Loading Priority");
  set(["Stow Position"], "Stow Position");
  set(["Order Reference", "order_ref", "ref"], "Order Reference");
  set(["Shipping Carrier", "carrier"], "Shipping Carrier");

  return m;
})();

const LIVE_BUFFER_FIELDS: Array<{ label: string; keys: string[] }> = [
  { label: "Destination", keys: ["destinationwarehouseid", "destination_warehouse_id"] },
  {
    label: "Item Name",
    keys: ["item_name", "itemname", "product_name", "productname", "product", "item"],
  },
  {
    label: "Tracking ID (Order ID)",
    keys: ["order_id", "orderid", "tracking_id", "trackingid", "order_reference", "orderreference"],
  },
  {
    label: "Truck Number",
    keys: ["truckid", "truck_id", "truck_number", "trucknumber", "truck_no", "truck"],
  },
  { label: "Ship Date", keys: ["ship_date", "shipdate", "shipping_date", "date"] },
  {
    label: "Expected Departure Time",
    keys: ["estimateddeparturetime", "expected_departure_time", "expecteddeparturetime", "departure_time", "etd"],
  },
  {
    label: "Origin (Origin Warehouse)",
    keys: ["currentwarehouseid", "current_warehouse_id", "origin", "origin_warehouse", "originwarehouse"],
  },
];

const BARCODE_ALIAS_GROUPS: string[][] = [
  ["Product Name", "Item Name", "Product", "Item"],
  ["Item Code", "Item ID", "Order Code", "Tracking ID", "Tracking Number", "Order ID", "Order Reference"],
  ["Truck Number", "Truck ID", "Truck No", "Truck"],
  ["Ship Date", "Shipping Date", "Date", "Departure Date"],
  ["Estimated Departure Time", "Expected Departure Time", "Departure Time", "ETD"],
  ["Estimated Arrival Time", "Expected Arrival Time", "Arrival Time", "ETA"],
  ["Current Warehouse ID", "Origin", "Origin Warehouse", "Current Warehouse"],
  ["Destination Warehouse ID", "Destination", "Destination Warehouse"],
  ["Shipping Dock ID", "Loading Dock ID", "Dock ID", "Dock", "Shipping Dock", "Loading Dock"],
  ["Loading Bay", "Bay", "Loading Bay ID", "Dock Bay"],
  ["Priority Class", "Priority"],
  ["Loading Time", "Load Time"],
  ["Loading Priority", "Load Priority"],
  ["Stow Position", "Stow Pos"],
  ["Order Reference", "Reference", "Order Ref"],
  ["Shipping Carrier", "Carrier"],
];

const BARCODE_TITLE_SET = new Set(BARCODE_FIELD_TITLES.map((title) => normalizeKey(title)));

const BARCODE_ALIAS_LOOKUP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const group of BARCODE_ALIAS_GROUPS) {
    const canonicalAlias = group.find((alias) => BARCODE_TITLE_SET.has(normalizeKey(alias))) ?? group[0];
    const canonicalKey = normalizeKey(canonicalAlias);
    for (const alias of group) {
      map[normalizeKey(alias)] = canonicalKey;
    }
  }
  return map;
})();

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|\[\]\\]/g, "\\$&");

const DEMO_RECORDS: KvPairs[] = [
  {
    destination_warehouse_id: "R1-A",
    item_name: "Widget Alpha",
    tracking_id: "TRK900001",
    truck_number: "301",
    ship_date: "2025-09-16",
    expected_departure_time: "10:15",
    origin: "Dock 1",
    item_code: "TRK900001",
  },
  {
    destination_warehouse_id: "R2-B",
    item_name: "Gizmo Max",
    tracking_id: "TRK900002",
    truck_number: "302",
    ship_date: "2025-09-16",
    expected_departure_time: "11:40",
    origin: "Inbound A",
    item_code: "TRK900002",
  },
  {
    destination_warehouse_id: "R3-C",
    item_name: "Box Large",
    tracking_id: "TRK900003",
    truck_number: "305",
    ship_date: "2025-09-17",
    expected_departure_time: "09:05",
    origin: "Dock 2",
    item_code: "TRK900003",
  },
];

const buildBarcodeSearchText = (barcodes: string[]): string | null => {
  if (!Array.isArray(barcodes) || barcodes.length === 0) return null;
  const combined = barcodes.join(" ");
  const normalized = normalizeForSearch(combined);
  return normalized.length > 0 ? normalized : null;
};

const MATCH_STATES = {
  match: { symbol: "✓", label: "Match", className: "text-green-600" },
  mismatch: { symbol: "✗", label: "Mismatch", className: "text-red-600" },
  noBarcode: { symbol: "–", label: "No barcode", className: "text-slate-500" },
  noValue: { symbol: "–", label: "No OCR value", className: "text-slate-500" },
} as const;

type MatchState = (typeof MATCH_STATES)[keyof typeof MATCH_STATES];

interface BarcodeFieldValue {
  raw: string;
  display: string;
  comparable: string;
}

interface BarcodeKeyValueData {
  kv: Map<string, string>;
  rawValues: string[];
}

const formatBarcodeValue = (normalizedKey: string, value: string): BarcodeFieldValue => {
  const raw = value;
  const trimmed = value.trim();
  const lowerKey = normalizedKey.toLowerCase();

  if (!trimmed) {
    return { raw, display: "", comparable: "" };
  }

  if (COMPACT_BARCODE_KEYS.has(lowerKey) || ID_LIKE_SET.has(lowerKey)) {
    let displayValue = trimmed.toUpperCase();
    displayValue = displayValue.replace(/\s*-\s*/g, "-");
    displayValue = displayValue.replace(/\s+/g, "");
    if (lowerKey.includes("truck")) {
      const hasDigit = /\d/.test(displayValue);
      if (hasDigit) displayValue = displayValue.replace(/^[A-Z]+/, "");
    }
    const comparable = displayValue.replace(/[^A-Z0-9]/g, "").toLowerCase();
    return { raw, display: displayValue, comparable };
  }

  if (lowerKey.includes("time")) {
    const parsed = parseTime(trimmed);
    if (parsed) {
      return {
        raw,
        display: formatTimeForDisplay(parsed),
        comparable: normalizeTimeForComparison(parsed),
      };
    }
  }

  if (lowerKey.includes("date")) {
    const parsed = parseDate(trimmed);
    if (parsed) {
      return {
        raw,
        display: formatDateForDisplay(parsed),
        comparable: normalizeDateForComparison(parsed),
      };
    }
  }

  const normalized = trimmed.replace(/\s+/g, " ");
  return { raw, display: normalized, comparable: normalized.toLowerCase() };
};

const valuesLooselyMatch = (left: BarcodeFieldValue, right: BarcodeFieldValue): boolean => {
  const comparableLeft = left.comparable;
  const comparableRight = right.comparable;
  if (comparableLeft && comparableRight) {
    if (comparableLeft === comparableRight) return true;
    if (comparableLeft.includes(comparableRight) || comparableRight.includes(comparableLeft)) return true;
  }

  const strictLeft = normalizeAlphanumeric(left.display);
  const strictRight = normalizeAlphanumeric(right.display);
  if (strictLeft && strictRight) {
    if (strictLeft === strictRight) return true;
    if (strictLeft.includes(strictRight) || strictRight.includes(strictLeft)) return true;
  }

  const looseLeft = normalizeForSearch(left.display);
  const looseRight = normalizeForSearch(right.display);
  if (looseLeft && looseRight) {
    if (looseLeft === looseRight) return true;
    if (looseLeft.includes(looseRight) || looseRight.includes(looseLeft)) return true;
  }

  return false;
};

const getCanonicalBarcodeKey = (rawKey: string): string | null => {
  const normalized = normalizeKey(rawKey);
  if (!normalized) return null;
  return BARCODE_ALIAS_LOOKUP[normalized] ?? (BARCODE_TITLE_SET.has(normalized) ? normalized : null);
};

const buildBarcodeKeyValueData = (barcodes: string[]): BarcodeKeyValueData => {
  const kv = new Map<string, string>();
  const rawValues = new Set<string>();

  const addValue = (key: string, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const existing = kv.get(key);
    if (!existing || trimmed.length > existing.length) {
      kv.set(key, trimmed);
    }
    rawValues.add(trimmed);
  };

  const textBlocks = (Array.isArray(barcodes) ? barcodes : []).map((b) =>
    typeof b === "string" ? b : String(b ?? ""),
  );

  const tryParseDelimitedBlock = (block: string) => {
    const separators = ["|", ";", "‖"];
    for (const separator of separators) {
      if (!block.includes(separator)) continue;
      const parts = block
        .split(separator)
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length < 2) continue;

      let extracted = false;
      for (let i = 0; i < parts.length; i += 1) {
        const possibleKey = parts[i];
        const canonical = getCanonicalBarcodeKey(possibleKey);
        if (!canonical) continue;

        let valueParts: string[] = [];
        for (let j = i + 1; j < parts.length; j += 1) {
          const maybeKey = getCanonicalBarcodeKey(parts[j]);
          if (maybeKey) break;
          valueParts.push(parts[j]);
          i = j;
        }

        const value = valueParts.join(" ").trim();
        if (value) {
          addValue(canonical, value);
          extracted = true;
        }
      }

      // Only early-return if we successfully extracted structured data.
      if (extracted) {
        return;
      }
    }
  };

  for (const block of textBlocks) {
    if (!block) continue;
    tryParseDelimitedBlock(block);
    const lines = block.split(/\r?\n/);
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      const colonMatch = trimmedLine.match(/^(.+?)[\s]*[:=|]\s*(.+)$/);
      if (colonMatch) {
        const canonical = getCanonicalBarcodeKey(colonMatch[1]);
        if (canonical) {
          addValue(canonical, colonMatch[2]);
          continue;
        }
      }

      const dashMatch = trimmedLine.match(/^(.+?)\s+-\s+(.+)$/);
      if (dashMatch) {
        const canonical = getCanonicalBarcodeKey(dashMatch[1]);
        if (canonical) {
          addValue(canonical, dashMatch[2]);
          continue;
        }
      }

      const doubleSpaceMatch = trimmedLine.match(/^(.+?)\s{2,}(.+)$/);
      if (doubleSpaceMatch) {
        const canonical = getCanonicalBarcodeKey(doubleSpaceMatch[1]);
        if (canonical) {
          addValue(canonical, doubleSpaceMatch[2]);
        }
      }
    }

    const tokens = block.match(/[A-Za-z0-9]{4,}/g);
    if (tokens) {
      for (const token of tokens) {
        rawValues.add(token);
      }
    }
  }

  const combinedText = textBlocks.join("\n");
  for (const group of BARCODE_ALIAS_GROUPS) {
    const canonicalAlias = group.find((alias) => BARCODE_TITLE_SET.has(normalizeKey(alias))) ?? group[0];
    const canonicalKey = getCanonicalBarcodeKey(canonicalAlias);
    if (!canonicalKey || kv.has(canonicalKey)) continue;
    for (const alias of group) {
      const aliasPattern = escapeRegex(alias);
      const regex = new RegExp(`${aliasPattern}\\s*[#:;=\\|\\-]*\\s*([^\\n\\r]+)`, "i");
      const match = combinedText.match(regex);
      if (match) {
        addValue(canonicalKey, match[1]);
        break;
      }
    }
  }

  return { kv, rawValues: Array.from(rawValues) };
};

const pickBestBarcodeId = (kv: Map<string, string>, rawValues: string[]): string | null => {
  for (const key of PREFERRED_ID_KEYS) {
    const candidate = kv.get(normalizeKey(key));
    if (candidate && candidate.trim()) {
      return candidate.trim();
    }
  }

  const candidates = new Set<string>();
  for (const value of kv.values()) {
    const trimmed = value.trim();
    if (trimmed) candidates.add(trimmed);
  }
  for (const value of rawValues) {
    const trimmed = String(value).trim();
    if (trimmed) candidates.add(trimmed);
  }

  const ordered = Array.from(candidates).sort((a, b) => b.length - a.length);
  for (const candidate of ordered) {
    if (/\d/.test(candidate)) {
      return candidate;
    }
  }

  return ordered[0] ?? null;
};

const LABEL_TO_RECORD_KEY: Record<string, keyof LiveRecord> = {
  Destination: "destination",
  "Item Name": "itemName",
  "Tracking ID (Order ID)": "trackingId",
  "Truck Number": "truckNumber",
  "Ship Date": "shipDate",
  "Expected Departure Time": "expectedDepartureTime",
  "Origin (Origin Warehouse)": "origin",
};

const buildLiveRecord = (getBufferValue: (keys: string[]) => string): LiveRecord | null => {
  const record: LiveRecord = {
    destination: "",
    itemName: "",
    trackingId: "",
    truckNumber: "",
    shipDate: "",
    expectedDepartureTime: "",
    origin: "",
  };

  for (const field of LIVE_BUFFER_FIELDS) {
    const key = LABEL_TO_RECORD_KEY[field.label];
    if (!key) continue;
    record[key] = getBufferValue(field.keys);
  }

  const hasValue = Object.values(record).some((v) => Boolean(v && v.trim()));
  return hasValue ? record : null;
};

export default function ScannerDashboard() {
  const [file, setFile] = useState<File | null>(null);
  const [kv, setKv] = useState<KvPairs | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [barcodes, setBarcodes] = useState<string[]>([]);
  const [barcodeWarnings, setBarcodeWarnings] = useState<string[]>([]);
  const [validation, setValidation] = useState<BarcodeValidation | null>(null);
  const [liveRecord, setLiveRecordState] = useState<LiveRecord | null>(null);
  const [bookingWarning, setBookingWarning] = useState<string | null>(null);
  const [bookingSuccess, setBookingSuccess] = useState<string | null>(null);
  const [vlmInfo, setVlmInfo] = useState<ProviderInfo | null>(null);
  const [checkingBooking, setCheckingBooking] = useState(false);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState<number>(DEFAULT_REFRESH_MS);
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const maybeStatus = (parsed as { status?: unknown }).status;
        setStatus(typeof maybeStatus === "string" ? maybeStatus : null);

        const maybeWarning = (parsed as { bookingWarning?: unknown }).bookingWarning;
        setBookingWarning(typeof maybeWarning === "string" ? maybeWarning : null);

        const maybeSuccess = (parsed as { bookingSuccess?: unknown }).bookingSuccess;
        setBookingSuccess(typeof maybeSuccess === "string" ? maybeSuccess : null);

        const maybeProviderInfo = (parsed as { providerInfo?: unknown }).providerInfo;
        setVlmInfo(sanitizeProviderInfo(maybeProviderInfo));

        const maybeKv = (parsed as { kv?: unknown }).kv;
        if (maybeKv && typeof maybeKv === "object" && !Array.isArray(maybeKv)) {
          setKv(maybeKv as KvPairs);
        }

        const maybeBarcodes = (parsed as { barcodes?: unknown }).barcodes;
        setBarcodes(Array.isArray(maybeBarcodes) ? maybeBarcodes.filter((v) => typeof v === "string") : []);

        const maybeBarcodeWarnings = (parsed as { barcodeWarnings?: unknown }).barcodeWarnings;
        setBarcodeWarnings(
          Array.isArray(maybeBarcodeWarnings)
            ? maybeBarcodeWarnings.filter((v) => typeof v === "string")
            : [],
        );

        const maybeValidation = (parsed as { validation?: unknown }).validation;
        if (maybeValidation && typeof maybeValidation === "object") {
          const val = maybeValidation as Partial<BarcodeValidation>;
          const status = val.status;
          const message = val.message;
          const matches = val.matches;
          const comparedValue = val.comparedValue;
          if (typeof status === "string" && typeof message === "string") {
            setValidation({
              status,
              message,
              matches: typeof matches === "boolean" ? matches : null,
              comparedValue: typeof comparedValue === "string" ? comparedValue : undefined,
            });
          }
        }

        const maybeRefresh = (parsed as { refreshIntervalMs?: unknown }).refreshIntervalMs;
        if (typeof maybeRefresh === "number" && Number.isFinite(maybeRefresh) && maybeRefresh > 0) {
          setRefreshIntervalMs(maybeRefresh);
        }
      }
    } catch (error) {
      console.error("Failed to load persisted scanner state", error);
    } finally {
      setHasHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hasHydrated || typeof window === "undefined") return;
    try {
      const payload = {
        status,
        bookingWarning,
        bookingSuccess,
        providerInfo: vlmInfo,
        kv,
        barcodes,
        barcodeWarnings,
        validation,
        refreshIntervalMs,
      };
      window.localStorage.setItem(PERSISTED_STATE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.error("Failed to persist scanner state", error);
    }
  }, [
    status,
    bookingWarning,
    bookingSuccess,
    kv,
    barcodes,
    barcodeWarnings,
    validation,
    vlmInfo,
    refreshIntervalMs,
    hasHydrated,
  ]);

  const mapApiRecordToLive = useCallback((record: ApiLiveBufferRecord): LiveRecord => ({
    destination: record.destination,
    itemName: record.itemName,
    trackingId: record.trackingId,
    truckNumber: record.truckNumber,
    shipDate: record.shipDate,
    expectedDepartureTime: record.expectedDepartureTime,
    origin: record.originLocation,
  }), []);

  const updateLiveRecord = useCallback((record: LiveRecord | null) => {
    setLiveRecordState(record);
  }, []);

  const fetchLiveBuffer = useCallback(async (options?: { sync?: boolean }) => {
    try {
      const query = options?.sync ? "?sync=true" : "";
      const response = await fetch(`/api/orders${query}`, { cache: "no-store" });
      const payload: { liveBuffer?: ApiLiveBufferRecord[]; record?: ApiLiveBufferRecord; error?: string } = await response
        .json()
        .catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : response.statusText);
      }
      const records = Array.isArray(payload.liveBuffer) ? payload.liveBuffer : [];
      if (records.length > 0) {
        updateLiveRecord(mapApiRecordToLive(records[0]));
      } else if (payload.record) {
        updateLiveRecord(mapApiRecordToLive(payload.record));
      } else {
        updateLiveRecord(null);
      }
    } catch (error) {
      console.error("Failed to load live buffer", error);
    }
  }, [mapApiRecordToLive, updateLiveRecord]);

  useEffect(() => {
    fetchLiveBuffer({ sync: true });
  }, [fetchLiveBuffer]);

  useEffect(() => {
    if (!refreshIntervalMs || typeof window === "undefined") return;
    const id = window.setInterval(() => {
      fetchLiveBuffer({ sync: true });
    }, refreshIntervalMs);
    return () => window.clearInterval(id);
  }, [refreshIntervalMs, fetchLiveBuffer]);

  const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "my-secret-api-key";

  const ocrKv = useMemo(() => {
    const m = new Map<string, string>();
    if (!kv) return m;
    const toStr = (v: any) =>
      v == null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v);
    for (const [k, v] of Object.entries(kv)) m.set(normalizeKey(k), toStr(v));
    return m;
  }, [kv]);

  const barcodeSearchText = useMemo(() => buildBarcodeSearchText(barcodes), [barcodes]);
  const barcodeStrictSearch = useMemo(() => normalizeAlphanumeric(barcodes.join(" ")), [barcodes]);
  const { kv: barcodeKv, rawValues: barcodeValues } = useMemo(
    () => buildBarcodeKeyValueData(barcodes),
    [barcodes],
  );

  const getBarcodeValueForOcrKey = (
    normalizedOcrKey: string,
    ocrRawValue: string,
  ): BarcodeFieldValue | null => {
    const trimmedOcrValue = typeof ocrRawValue === "string" ? ocrRawValue.trim() : "";
    if (!trimmedOcrValue) return null;

    const canonicalBarcodeKey = OCR_TO_BARCODE_KEY[normalizedOcrKey] ?? normalizedOcrKey;
    const formattedOcr = formatBarcodeValue(normalizedOcrKey, trimmedOcrValue);

    let fallbackCandidate: BarcodeFieldValue | null = null;

    const directCandidateRaw = barcodeKv.get(canonicalBarcodeKey);
    if (directCandidateRaw && directCandidateRaw.trim()) {
      const formattedDirect = formatBarcodeValue(canonicalBarcodeKey, directCandidateRaw);
      if (valuesLooselyMatch(formattedOcr, formattedDirect)) {
        return formattedDirect;
      }
      fallbackCandidate = fallbackCandidate ?? formattedDirect;
    }

    if (ID_LIKE_SET.has(normalizedOcrKey)) {
      const fallbackId = pickBestBarcodeId(barcodeKv, barcodeValues);
      if (fallbackId && fallbackId.trim()) {
        const formattedId = formatBarcodeValue(canonicalBarcodeKey, fallbackId);
        if (valuesLooselyMatch(formattedOcr, formattedId)) {
          return formattedId;
        }
        fallbackCandidate = fallbackCandidate ?? formattedId;
      }
    }

    for (const [key, value] of barcodeKv.entries()) {
      if (!value || !value.trim()) continue;
      const formattedCandidate = formatBarcodeValue(key, value);
      if (valuesLooselyMatch(formattedOcr, formattedCandidate)) {
        return formattedCandidate;
      }
      if (!fallbackCandidate) {
        fallbackCandidate = formattedCandidate;
      }
    }

    for (const rawValue of barcodeValues) {
      if (!rawValue || !rawValue.trim()) continue;
      const formattedCandidate = formatBarcodeValue(canonicalBarcodeKey, rawValue);
      if (valuesLooselyMatch(formattedOcr, formattedCandidate)) {
        return formattedCandidate;
      }
    }

    return fallbackCandidate;
  };

  const getRowMatch = (
    normalizedKey: string,
    ocrValue: string,
    barcodeValue: BarcodeFieldValue | null,
  ): MatchState => {
    const trimmedOcrValue = typeof ocrValue === "string" ? ocrValue.trim() : "";
    if (!trimmedOcrValue) {
      return MATCH_STATES.noValue;
    }

    const formattedOcr = formatBarcodeValue(normalizedKey, trimmedOcrValue);

    if (barcodeValue) {
      if (valuesLooselyMatch(formattedOcr, barcodeValue)) {
        return MATCH_STATES.match;
      }

      const ocrLoose = normalizeForSearch(formattedOcr.display);
      if (ocrLoose) {
        const barcodeLooseCandidates = [
          normalizeForSearch(barcodeValue.display),
          normalizeForSearch(barcodeValue.raw),
        ].filter(Boolean) as string[];

        if (barcodeLooseCandidates.some((candidate) => candidate.includes(ocrLoose))) {
          return MATCH_STATES.match;
        }

        if (barcodeSearchText && barcodeSearchText.includes(ocrLoose)) {
          return MATCH_STATES.match;
        }
      }

      const ocrStrict = normalizeAlphanumeric(formattedOcr.display);
      if (ocrStrict) {
        const barcodeStrict = normalizeAlphanumeric(`${barcodeValue.display} ${barcodeValue.raw}`);
        if (barcodeStrict.includes(ocrStrict)) {
          return MATCH_STATES.match;
        }
        if (barcodeSearchText && barcodeSearchText.replace(/\s+/g, "").includes(ocrStrict)) {
          return MATCH_STATES.match;
        }
        if (barcodeStrictSearch.includes(ocrStrict)) {
          return MATCH_STATES.match;
        }
      }

      return MATCH_STATES.mismatch;
    }

    const ocrLoose = normalizeForSearch(formattedOcr.display);
    if (ocrLoose && barcodeSearchText && barcodeSearchText.includes(ocrLoose)) {
      return MATCH_STATES.match;
    }

    const ocrStrict = normalizeAlphanumeric(formattedOcr.display);
    if (ocrStrict && barcodeStrictSearch.includes(ocrStrict)) {
      return MATCH_STATES.match;
    }

    return MATCH_STATES.noBarcode;
  };

  const getBufferValue = (keys: string[]) => {
    for (const k of keys) {
      const v = ocrKv.get(normalizeKey(k));
      if (v && v.trim()) return v.trim();
    }
    return "";
  };

  const bufferDestination = LIVE_BUFFER_FIELDS[0]
    ? getBufferValue(LIVE_BUFFER_FIELDS[0].keys)
    : "";
  const activeDestination =
    (liveRecord?.destination && liveRecord.destination.trim()) ||
    (bufferDestination && bufferDestination.trim()) ||
    "";

  useEffect(() => {
    if (!kv) return;
    const record = buildLiveRecord(getBufferValue);
    if (record) {
      updateLiveRecord(record);
    }
  }, [kv, updateLiveRecord]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFile(f ?? null);
    setKv(null);
    setStatus(null);
    setBarcodes([]);
    setBarcodeWarnings([]);
    setValidation(null);
    setBookingWarning(null);
  };

  const scanDocument = async () => {
    if (!file) return;
    setLoading(true);
    setStatus("Uploading file and scanning…");
    setVlmInfo(null);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "x-api-key": API_KEY },
        body: formData,
      });
      if (!res.ok) {
        let text = "";
        try {
          text = await res.text();
        } catch (error) {
          text = "";
        }
        const reason = parseErrorPayload(text) || res.statusText || DEFAULT_SCAN_ERROR_MESSAGE;
        throw new Error(reason);
      }

      const data: ApiOcrResponse = await res.json();
      const nextProviderInfo = sanitizeProviderInfo(data.providerInfo);

      const errorMessage = typeof data.error === "string" ? data.error.trim() : "";
      if (errorMessage) {
        setStatus(errorMessage);
        setKv(null);
        setBarcodes([]);
        setBarcodeWarnings([]);
        setValidation(null);
        setBookingWarning(null);
        setBookingSuccess(null);
        setVlmInfo(nextProviderInfo ?? null);
        updateLiveRecord(null);
        return;
      }

      setKv(data.kv || {});
      setBarcodes(Array.isArray(data.barcodes) ? data.barcodes : []);
      setBarcodeWarnings(Array.isArray(data.barcodeWarnings) ? data.barcodeWarnings : []);
      setValidation(toClientValidation(data.validation));

      const statusFromValidation: Record<ValidationStatus, string> = {
        match: "Barcode and OCR values align. Checking database…",
        mismatch: data.validation?.message || "Barcode and OCR values mismatch.",
        no_barcode: "No barcode detected; continuing with OCR results.",
        missing_item_code: "Barcode detected but OCR did not yield an item code.",
      };

      const vStatus = data.validation?.status;
      if (vStatus) setStatus(statusFromValidation[vStatus]);

      const normalizedKv = new Map<string, string>();
      if (data.kv) {
        for (const [key, value] of Object.entries(data.kv)) {
          const normalized = normalizeKey(key);
          const formatted =
            value == null
              ? ""
              : Array.isArray(value)
              ? value.join(", ")
              : typeof value === "object"
              ? JSON.stringify(value)
              : String(value);
          normalizedKv.set(normalized, formatted.trim());
        }
      }

      const recordCandidate = buildLiveRecord((keys) => {
        for (const key of keys) {
          const val = normalizedKv.get(normalizeKey(key));
          if (val && val.trim()) return val.trim();
        }
        return "";
      });

      if (recordCandidate) {
        const missingField = (Object.entries(recordCandidate) as Array<[keyof LiveRecord, string]>).find(
          ([, value]) => !value || !value.trim(),
        );
        if (missingField) {
          setStatus(
            `Live buffer updated locally but missing "${missingField[0]}" to sync with the history log.`,
          );
          setBookingWarning(null);
          setBookingSuccess(null);
          setVlmInfo(null);
        } else {
          const trackingIdForStatus = recordCandidate.trackingId;
          setStatus(`Logging scan for ${trackingIdForStatus}…`);
          setBookingWarning(null);
          setBookingSuccess(null);
          const response = await fetch(`/api/orders`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
            body: JSON.stringify({
              destination: recordCandidate.destination,
              itemName: recordCandidate.itemName,
              trackingId: recordCandidate.trackingId,
              truckNumber: recordCandidate.truckNumber,
              shipDate: recordCandidate.shipDate,
              expectedDepartureTime: recordCandidate.expectedDepartureTime,
              originLocation: recordCandidate.origin,
            }),
          });
          const payload: {
            record?: {
              destination: string;
              itemName: string;
              trackingId: string;
              truckNumber: string;
              shipDate: string;
              expectedDepartureTime: string;
              originLocation: string;
            };
            historyEntry?: ApiHistoryEntry;
            warning?: string;
            error?: string;
          } = await response.json().catch(() => ({ error: "" }));
          if (!response.ok) {
            const reason = typeof payload.error === "string" && payload.error ? payload.error : response.statusText;
            setStatus(reason || "Failed to log scan.");
            setBookingWarning(null);
            setBookingSuccess(null);
            setVlmInfo(null);
          } else {
            const record = payload.record;
            const warningRaw = typeof payload.warning === "string" ? payload.warning.trim() : "";
            const warning = warningRaw.length > 0 ? warningRaw : null;
            setBookingWarning(warning);
            const trackedId = record?.trackingId || recordCandidate.trackingId;
            if (warning) {
              setBookingSuccess(null);
            } else if (trackedId) {
              setBookingSuccess(`Booked item found for ${trackedId}`);
            } else {
              setBookingSuccess("Booked item found");
            }
            if (record) {
              const nextRecord: LiveRecord = {
                destination: record.destination,
                itemName: record.itemName,
                trackingId: record.trackingId,
                truckNumber: record.truckNumber,
                shipDate: record.shipDate,
                expectedDepartureTime: record.expectedDepartureTime,
                origin: record.originLocation,
              };
              updateLiveRecord(nextRecord);
            }
            const displayTrackingId = record?.trackingId || recordCandidate.trackingId;
            const statusSegments: string[] = [];
            if (displayTrackingId) {
              statusSegments.push(`Order ${displayTrackingId} -`);
            }
            statusSegments.push("Saved to history.");
            const trailingMessage = warning
              ? warning.endsWith(".")
                ? warning
                : `${warning}.`
              : "Booked item found.";
            statusSegments.push(trailingMessage);
            setStatus(statusSegments.join(" ").replace(/\s+/g, " ").trim());
            setVlmInfo(nextProviderInfo ?? null);
          }
        }
      }
    } catch (err) {
      console.error(err);
      setStatus(formatStatusError(err));
      setBookingWarning(null);
      setBookingSuccess(null);
      setVlmInfo(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDemoScan = () => {
    const sample = DEMO_RECORDS[Math.floor(Math.random() * DEMO_RECORDS.length)];
    setFile(null);
    setKv(sample);
    setStatus("Demo scan loaded into the live buffer.");
    setBarcodes([]);
    setBarcodeWarnings([]);
    setValidation(null);
    setBookingWarning(null);
    setBookingSuccess(null);
    setVlmInfo(null);
  };

  const handleRecheckBooking = useCallback(async () => {
    const activeTrackingId = liveRecord?.trackingId?.trim();
    if (!activeTrackingId) {
      setStatus("No tracking ID available to recheck.");
      return;
    }

    setCheckingBooking(true);
    try {
      const params = new URLSearchParams({
        trackingId: activeTrackingId,
        verifyBooking: "true",
      });
      const response = await fetch(`/api/orders?${params.toString()}`, { cache: "no-store" });
      const payload: {
        record?: ApiLiveBufferRecord;
        bookingFound?: boolean;
        warning?: string;
        message?: string;
        error?: string;
      } = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : response.statusText);
      }

      if (payload.record) {
        updateLiveRecord(mapApiRecordToLive(payload.record));
      }

      const refreshedTrackingId = payload.record?.trackingId?.trim() || activeTrackingId;
      const warningMessage = typeof payload.warning === "string" ? payload.warning.trim() : "";
      const message = typeof payload.message === "string" ? payload.message.trim() : "";

      if (payload.bookingFound) {
        const successCopy = message || `Booked item found for ${refreshedTrackingId}`;
        setBookingWarning(null);
        setBookingSuccess(successCopy);
        const statusSegments: string[] = [];
        if (refreshedTrackingId) {
          statusSegments.push(`Order ${refreshedTrackingId} -`);
        }
        statusSegments.push("Booked item found.");
        setStatus(statusSegments.join(" ").replace(/\s+/g, " ").trim());
      } else {
        const warningCopy = warningMessage || message || "Booked item not found";
        setBookingWarning(warningCopy);
        setBookingSuccess(null);
        const statusSegments: string[] = [];
        if (refreshedTrackingId) {
          statusSegments.push(`Order ${refreshedTrackingId} -`);
        }
        statusSegments.push("Booked item not found.");
        setStatus(statusSegments.join(" ").replace(/\s+/g, " ").trim());
      }
    } catch (error) {
      console.error("Failed to recheck booking status", error);
      setStatus("Failed to recheck booking status.");
    } finally {
      setCheckingBooking(false);
    }
  }, [liveRecord, mapApiRecordToLive, updateLiveRecord]);

  const handleRefreshIntervalChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const rawValue = Number(event.target.value);
      if (Number.isFinite(rawValue) && rawValue > 0) {
        setRefreshIntervalMs(rawValue);
        fetchLiveBuffer({ sync: true });
      }
    },
    [fetchLiveBuffer],
  );

  const handleWriteStorage = async () => {
    if (!liveRecord) return;
    try {
      const response = await fetch("/api/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: liveRecord.destination,
          itemName: liveRecord.itemName,
          trackingId: liveRecord.trackingId,
          truckNumber: liveRecord.truckNumber,
          shipDate: liveRecord.shipDate,
          expectedDepartureTime: liveRecord.expectedDepartureTime,
          originLocation: liveRecord.origin,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : response.statusText);
      }
      setStatus(`Storage updated for ${liveRecord.trackingId}.`);
    } catch (err) {
      console.error(err);
      setStatus(err instanceof Error ? err.message : "Failed to write storage.");
    }
  };

  const handleClearLive = async () => {
    try {
      const response = await fetch("/api/orders", { method: "DELETE" });
      const payload: { liveBuffer?: ApiLiveBufferRecord[]; error?: string } = await response
        .json()
        .catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : response.statusText);
      }
      const records = Array.isArray(payload.liveBuffer) ? payload.liveBuffer : [];
      if (records.length > 0) {
        updateLiveRecord(mapApiRecordToLive(records[0]));
      } else {
        updateLiveRecord(null);
      }
      setKv(null);
      setBarcodes([]);
      setBarcodeWarnings([]);
      setValidation(null);
      setStatus("Live buffer cleared.");
      setBookingWarning(null);
      setBookingSuccess(null);
      setVlmInfo(null);
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "Failed to clear live buffer.");
    }
  };

  return (
    <div className="space-y-12">
      <section className="glassy-panel rounded-3xl px-6 py-8 sm:px-10 sm:py-12">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3 text-center lg:text-left">
            <h2 className="text-3xl font-semibold text-slate-100 md:text-4xl">
              Scan documents with confidence
            </h2>
            <p className="text-sm text-slate-300/80 md:text-base">
              Upload or capture manifests and watch realtime OCR decode destinations, validate barcodes, and route your
              inventory without friction.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 text-xs font-medium text-slate-300/70">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              99% OCR confidence streak
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2">
              <span className="h-2 w-2 rounded-full bg-indigo-400" />
              Barcode parity monitoring
            </span>
          </div>
        </div>
        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-stretch">
          <div className="rounded-3xl border-2 border-dashed border-white/15 bg-white/5 px-8 py-10 text-center transition hover:border-indigo-400/60 hover:bg-indigo-500/5">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-300">
              <svg className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16.5v1.25A2.25 2.25 0 006.25 20h11.5A2.25 2.25 0 0020 17.75V16.5M4 7.5V6.25A2.25 2.25 0 016.25 4h11.5A2.25 2.25 0 0120 6.25V7.5M12 12v8m0-8l3 3m-3-3l-3 3" />
              </svg>
            </div>
            <h3 className="mt-6 text-lg font-semibold text-slate-100">Upload order sheet</h3>
            <p className="mt-2 text-sm text-slate-400">PNG, JPG, PDF up to 10MB</p>
            <div className="mt-6 space-y-4 text-left">
              <Input type="file" accept="image/*,application/pdf" onChange={handleFileChange} className="cursor-pointer" />
              <Button className="w-full justify-center" onClick={scanDocument} disabled={!file || loading}>
                {loading ? "Scanning…" : "Scan document"}
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <span className="h-12 w-px bg-white/10 lg:h-full" />
              <div className="flex items-center gap-3 text-xs uppercase tracking-[0.5em]">
                <span className="hidden h-px w-10 bg-white/10 sm:block" />
                <span>or</span>
                <span className="hidden h-px w-10 bg-white/10 sm:block" />
              </div>
              <span className="h-12 w-px bg-white/10 lg:h-full" />
            </div>
          </div>
          <div className="rounded-3xl border-2 border-dashed border-white/15 bg-white/5 px-8 py-10 text-center transition hover:border-indigo-400/60 hover:bg-indigo-500/5">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-300">
              <svg className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h3.75L10 4h4l2.25 3H20v12H4z" />
              </svg>
            </div>
            <h3 className="mt-6 text-lg font-semibold text-slate-100">Use camera demo</h3>
            <p className="mt-2 text-sm text-slate-400">
              Instantly seed the live buffer with curated manifests to preview the workflow without capturing a file.
            </p>
            <div className="mt-6">
              <Button type="button" onClick={handleDemoScan} className="justify-center">
                Launch camera (demo)
              </Button>
            </div>
          </div>
        </div>
      </section>

      {status && (
        <div className="glassy-panel rounded-2xl border border-indigo-400/30 bg-indigo-500/10 px-5 py-4 text-sm text-indigo-100">
          <span className="font-semibold uppercase tracking-[0.3em] text-indigo-200/90">Status</span>
          <p className="mt-2 text-base text-slate-100/90">{status}</p>
        </div>
      )}

      {vlmInfo && (
        <div className="glassy-panel rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-slate-100">
          <span className="font-semibold uppercase tracking-[0.3em] text-slate-300/80">VLM configuration</span>
          <dl className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-300/70">Provider type</dt>
              <dd className="mt-1 text-base text-slate-100/90">{describeProviderType(vlmInfo)}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-300/70">Model ID / deployment</dt>
              <dd className="mt-1 break-words text-base text-slate-100/90">{vlmInfo.modelId || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-300/70">Endpoint</dt>
              <dd className="mt-1 break-words text-base text-indigo-100/90">
                {(() => {
                  const endpoint = describeProviderLink(vlmInfo);
                  if (endpoint.href) {
                    return (
                      <a
                        href={endpoint.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-200 hover:text-indigo-100 hover:underline"
                      >
                        {endpoint.label}
                      </a>
                    );
                  }
                  return <span className="text-slate-100/90">{endpoint.label || "—"}</span>;
                })()}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {bookingWarning && (
        <div className="glassy-panel flex items-start gap-3 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-100">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-400/15">
            <svg
              className="h-5 w-5 text-rose-300"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v5m0 4h.01" />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 3.75a8.25 8.25 0 110 16.5 8.25 8.25 0 010-16.5z"
              />
            </svg>
          </span>
          <div className="flex w-full flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="font-semibold uppercase tracking-[0.3em] text-rose-200/80">Booking alert</span>
              <p className="mt-2 text-base text-rose-100/90">{bookingWarning}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleRecheckBooking}
              disabled={checkingBooking}
              className="shrink-0 border-rose-400/60 px-4 py-2 text-xs text-rose-100 hover:bg-rose-500/10 hover:text-rose-50"
            >
              {checkingBooking ? "Checking…" : "Check again"}
            </Button>
          </div>
        </div>
      )}

      {bookingSuccess && (
        <div className="glassy-panel flex items-start gap-3 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-400/15">
            <svg
              className="h-5 w-5 text-emerald-300"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </span>
          <div>
            <span className="font-semibold uppercase tracking-[0.3em] text-emerald-200/80">Booking status</span>
            <p className="mt-2 text-base text-emerald-100/90">{bookingSuccess}</p>
          </div>
        </div>
      )}

      {kv && (
        <Card header={<span className="text-lg font-semibold text-slate-100">Extracted OCR &amp; barcode data</span>}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-white/5 text-left text-xs font-medium uppercase tracking-wide text-slate-300/80">
                <tr>
                  <th className="px-4 py-3">Field</th>
                  <th className="px-4 py-3">OCR value</th>
                  <th className="px-4 py-3">Barcode value</th>
                  <th className="px-4 py-3 text-right">Match</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(kv).map(([rawKey, rawVal]) => {
                  const ocrKey = normalizeKey(rawKey);
                  const ocrValue = String(rawVal ?? "");
                  const barcodeValue = getBarcodeValueForOcrKey(ocrKey, ocrValue);
                  const match = getRowMatch(ocrKey, ocrValue, barcodeValue);

                  return (
                    <tr key={rawKey} className="border-b border-white/10 last:border-0">
                      <td className="px-4 py-3 font-medium text-slate-100">{rawKey}</td>
                      <td className="px-4 py-3 text-slate-200">{ocrValue}</td>
                      <td className={`px-4 py-3 ${barcodeValue ? "text-slate-200" : "text-slate-500"}`}>
                        {barcodeValue?.display ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-flex items-center justify-end gap-2 text-sm ${match.className}`}>
                          <span aria-hidden>{match.symbol}</span>
                          <span className="text-xs uppercase tracking-wide">{match.label}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {validation && (
            <p
              className={`mt-4 text-xs font-medium ${
                validation.status === "mismatch"
                  ? "text-rose-400"
                  : validation.status === "match"
                  ? "text-emerald-400"
                  : "text-slate-300"
              }`}
            >
              {validation.message}
            </p>
          )}

          {barcodeWarnings.length > 0 && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-slate-200/90">
              <p className="mb-2 font-semibold text-slate-100">Warnings</p>
              <ul className="list-inside list-disc space-y-1 text-slate-300/80">
                {barcodeWarnings.map((w, i) => (
                  <li key={`${w}-${i}`}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {liveRecord && (
        <Card
          header={
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold text-slate-100">Live buffer (latest scan)</span>
                {(bookingWarning || bookingSuccess) && (
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full ${
                      bookingWarning ? "bg-rose-500/15" : "bg-emerald-500/15"
                    }`}
                    title={bookingWarning ?? bookingSuccess ?? undefined}
                  >
                    {bookingWarning ? (
                      <svg
                        className="h-4 w-4 text-rose-400"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v5m0 4h.01" />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 3.75a8.25 8.25 0 110 16.5 8.25 8.25 0 010-16.5z"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="h-4 w-4 text-emerald-400"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                    <span className="sr-only">{bookingWarning ?? bookingSuccess}</span>
                  </span>
                )}
              </div>
              <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.3em] text-slate-300/70 sm:flex-row sm:items-center sm:gap-3">
                <span className="font-semibold text-slate-300/80">Auto refresh</span>
                <select
                  value={refreshIntervalMs}
                  onChange={handleRefreshIntervalChange}
                  className="rounded-full border border-white/15 bg-slate-900/70 px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-slate-100 shadow-sm transition focus:border-indigo-400 focus:outline-none focus:ring-0"
                >
                  {REFRESH_INTERVAL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} className="text-slate-900">
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          }
          footer={
            <div className="flex flex-wrap justify-end gap-3">
              <Button onClick={handleWriteStorage}>Write to storage</Button>
              <Button onClick={handleClearLive} variant="outline">
                Clear live buffer
              </Button>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-white/5 text-left text-xs font-medium uppercase tracking-wide text-slate-300/80">
                <tr>
                  <th className="px-4 py-3">Destination</th>
                  <th className="px-4 py-3">Item name</th>
                  <th className="px-4 py-3">Tracking ID</th>
                  <th className="px-4 py-3">Truck number</th>
                  <th className="px-4 py-3">Ship date</th>
                  <th className="px-4 py-3">Expected departure</th>
                  <th className="px-4 py-3">Origin</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-white/10">
                  <td className="px-4 py-3 text-slate-200">{liveRecord.destination || "—"}</td>
                  <td className="px-4 py-3 text-slate-200">{liveRecord.itemName || "—"}</td>
                  <td className="px-4 py-3 text-slate-200">{liveRecord.trackingId || "—"}</td>
                  <td className="px-4 py-3 text-slate-200">{liveRecord.truckNumber || "—"}</td>
                  <td className="px-4 py-3 text-slate-200">{liveRecord.shipDate || "—"}</td>
                  <td className="px-4 py-3 text-slate-200">{liveRecord.expectedDepartureTime || "—"}</td>
                  <td className="px-4 py-3 text-slate-200">{liveRecord.origin || "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}


      <FloorMapViewer activeDestination={activeDestination || undefined} />
    </div>
  );
}

