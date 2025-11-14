"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { FloorMapViewer } from "@/components/scanner/floor-map-viewer";
import { apiFetch } from "@/lib/api-client";

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
  status: "match" | "mismatch" | "no_barcode" | "missing_item_code" | "disabled";
  message: string;
  comparedValue?: string;
}

type ValidationStatus = "match" | "mismatch" | "no_barcode" | "missing_item_code" | "disabled";

type ComparisonStatus = "MATCH" | "MISMATCH" | "MISSING" | "DISABLED";

interface BarcodeComparisonRow {
  key: string;
  ocr: string;
  barcodeLabel: string;
  barcodeValue: string;
  status: ComparisonStatus;
  contextLabel?: string;
}

interface BarcodeComparisonSummary {
  matched: number;
  mismatched: number;
  missing: number;
}

interface BarcodeOnlyEntry {
  class: string;
  labels: string[];
  value: string;
  count: number;
}

interface BarcodeComparisonReport {
  rows: BarcodeComparisonRow[];
  summary: BarcodeComparisonSummary;
  library: {
    entriesCount: number;
    missedByOcrCount: number;
    missedByOcr: BarcodeOnlyEntry[];
  };
  barcodeText?: string;
}

// Normalizes various barcode comparison payload shapes returned by upstream OCR services
// into a consistent structure that the UI can render safely. Any unexpected input is
// coerced into conservative defaults so we never attempt to read undefined fields.
const sanitizeBarcodeComparison = (value: unknown): BarcodeComparisonReport | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const toStatus = (status: unknown): ComparisonStatus => {
    const normalized = typeof status === "string" ? status.toUpperCase() : "MISSING";
    return normalized === "MATCH" || normalized === "MISMATCH" || normalized === "MISSING" || normalized === "DISABLED"
      ? (normalized as ComparisonStatus)
      : "MISSING";
  };

  const rowSource = Array.isArray(raw.rows)
    ? raw.rows
    : Array.isArray(raw.results)
    ? raw.results
    : [];

  const rawRows = (rowSource as unknown[])
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const entry = row as Record<string, unknown>;
      return {
        key: typeof entry.key === "string" ? entry.key : "",
        ocr: typeof entry.ocr === "string" ? entry.ocr : "",
        barcodeLabel:
          typeof entry.barcodeLabel === "string"
            ? entry.barcodeLabel
            : typeof entry.barcode_label === "string"
            ? entry.barcode_label
            : "",
        barcodeValue:
          typeof entry.barcodeValue === "string"
            ? entry.barcodeValue
            : typeof entry.barcode_value === "string"
            ? entry.barcode_value
            : "",
        status: toStatus(entry.status),
        contextLabel:
          typeof entry.contextLabel === "string"
            ? entry.contextLabel
            : typeof entry.context_label === "string"
            ? entry.context_label
            : undefined,
      } as BarcodeComparisonRow;
    })
    .filter((row): row is BarcodeComparisonRow => Boolean(row));

  const rows = rawRows.map((row) => {
    if (row.status === "MATCH" || row.status === "DISABLED") return row;
    const barcodeValue = row.barcodeValue.trim();
    if (!barcodeValue) {
      return { ...row, status: "MISSING" as ComparisonStatus };
    }
    return row;
  });

  const summarySource =
    raw.summary && typeof raw.summary === "object" ? (raw.summary as Record<string, unknown>) : {};
  const toNumber = (input: unknown) => (typeof input === "number" && Number.isFinite(input) ? input : 0);
  const baseSummary: BarcodeComparisonSummary = {
    matched: toNumber(summarySource.matched),
    mismatched: toNumber(summarySource.mismatched),
    missing: toNumber(summarySource.missing),
  };

  const computedSummary = rows.reduce(
    (acc, row) => {
      switch (row.status) {
        case "MATCH":
          acc.matched += 1;
          break;
        case "MISSING":
          acc.missing += 1;
          break;
        default:
          acc.mismatched += 1;
      }
      return acc;
    },
    { matched: 0, mismatched: 0, missing: 0 } as BarcodeComparisonSummary,
  );

  const summary = rows.length > 0 ? computedSummary : baseSummary;

  const librarySource =
    raw.library && typeof raw.library === "object" ? (raw.library as Record<string, unknown>) : {};
  const missedRaw =
    Array.isArray(librarySource.missedByOcr)
      ? librarySource.missedByOcr
      : Array.isArray(librarySource.missed_by_ocr)
      ? librarySource.missed_by_ocr
      : [];
  const missed: BarcodeOnlyEntry[] = missedRaw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      return {
        class: typeof item.class === "string" ? item.class : "unknown",
        labels: Array.isArray(item.labels)
          ? item.labels.filter((lbl): lbl is string => typeof lbl === "string")
          : [],
        value: typeof item.value === "string" ? item.value : "",
        count: toNumber(item.count),
      } as BarcodeOnlyEntry;
    })
    .filter((entry): entry is BarcodeOnlyEntry => Boolean(entry));

  const library = {
    entriesCount: toNumber(librarySource.entriesCount ?? librarySource.entries_count),
    missedByOcrCount: toNumber(librarySource.missedByOcrCount ?? librarySource.missed_by_ocr_count),
    missedByOcr: missed,
  };

  const barcodeTextValue =
    typeof raw.barcodeText === "string"
      ? raw.barcodeText
      : typeof raw.barcode_text === "string"
      ? raw.barcode_text
      : undefined;

  return { rows, summary, library, barcodeText: barcodeTextValue };
};

// Display metadata for each barcode comparison state so the table and summary can share
// consistent icons and colors.
const COMPARISON_STATUS_META: Record<ComparisonStatus, { symbol: string; label: string; className: string }> = {
  MATCH: { symbol: "✓", label: "Match", className: "text-emerald-400" },
  MISMATCH: { symbol: "✕", label: "Mismatch", className: "text-rose-400" },
  MISSING: { symbol: "–", label: "Missing", className: "text-amber-300" },
  DISABLED: { symbol: "○", label: "Disabled", className: "text-slate-400" },
};

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
];

interface ApiValidation {
  status: ValidationStatus;
  message: string;
  comparedValue?: string;
  matches?: boolean | null;
}

interface ApiOcrResponse {
  kv?: KvPairs;
  selectedKv?: KvPairs;
  barcodes?: string[];
  barcodeWarnings?: string[];
  barcodeComparison?: BarcodeComparisonReport;
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

type ExecutionMode = "remote-http" | "local-service" | "local-cli";

interface ProviderInfo {
  mode: ProviderMode;
  providerType?: string;
  modelId?: string;
  baseUrl?: string;
  execution?: ExecutionMode;
  executionDebug?: string[];
}

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  "openai-compatible": "OpenAI-compatible",
  huggingface: "Hugging Face Inference",
  "generic-http": "Generic HTTP",
  local: "Local OCR pipeline",
};

// Client-side cache key for persisting dashboard state between reloads.
const PERSISTED_STATE_KEY = "scanner.dashboard.ui_state.v1";
// Default background refresh interval when continuously monitoring bookings.
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

// Attempts to unwrap nested JSON error envelopes returned by proxy services so that the
// operator receives a concise, human-readable failure reason.
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

// Reduces arbitrary error objects into the final status banner string shown to the user.
// The function walks nested "cause" chains and string payloads to surface the most
// actionable explanation possible.
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

// Converts provider metadata returned by the OCR backend into strongly typed fields.
// Unknown or malformed values are discarded so the UI only renders trusted data.
const sanitizeProviderInfo = (value: unknown): ProviderInfo | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const rawMode = trimString(raw.mode);
  const normalizedMode = rawMode === "remote" || rawMode === "local" ? (rawMode as ProviderMode) : null;
  if (!normalizedMode) return null;

  const rawExecution = trimString(raw.execution);
  const normalizedExecution =
    rawExecution === "remote-http" || rawExecution === "local-service" || rawExecution === "local-cli"
      ? (rawExecution as ExecutionMode)
      : undefined;

  const rawDebug = raw.executionDebug;
  const debugEntries = Array.isArray(rawDebug)
    ? rawDebug
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry): entry is string => entry.length > 0)
    : undefined;

  return {
    mode: normalizedMode,
    providerType: trimString(raw.providerType),
    modelId: trimString(raw.modelId),
    baseUrl: trimString(raw.baseUrl),
    execution: normalizedExecution,
    executionDebug: debugEntries,
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

const describeExecutionMode = (info: ProviderInfo): string => {
  switch (info.execution) {
    case "local-service":
      return "Persistent local service";
    case "local-cli":
      return "One-off local CLI";
    case "remote-http":
      return "Remote HTTP provider";
    default:
      return info.mode === "local" ? "Local pipeline" : "Remote provider";
  }
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
  let matches: boolean | null;
  if (typeof v.matches === "boolean" || v.matches === null) {
    matches = v.matches;
  } else if (v.status === "match") {
    matches = true;
  } else if (v.status === "mismatch") {
    matches = false;
  } else {
    matches = null;
  }
  return {
    matches,
    status: v.status,
    message: v.message,
    comparedValue: v.comparedValue,
  };
};

const normalizeKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const toDisplayString = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((entry) => toDisplayString(entry))
      .filter((segment) => segment.length > 0)
      .join(", ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(value);
    }
  }
  return String(value).trim();
};

const toNormalizedMap = (pairs: KvPairs | null): Map<string, string> => {
  const map = new Map<string, string>();
  if (!pairs) return map;
  for (const [key, rawValue] of Object.entries(pairs)) {
    if (typeof key !== "string") continue;
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) continue;
    map.set(normalizedKey, toDisplayString(rawValue));
  }
  return map;
};

const getValueFromMap = (map: Map<string, string>, keys: string[]): string => {
  for (const key of keys) {
    const candidate = map.get(normalizeKey(key));
    if (candidate && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
};



// Maps noisy OCR field labels into canonical barcode labels so that comparisons are
// resilient to upstream naming differences.
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
  { label: "Destination", keys: ["destination", "destinationwarehouseid", "destination_warehouse_id"] },
  {
    label: "Item Name",
    keys: ["item_name", "itemname", "product_name", "productname", "product", "item"],
  },
  {
    label: "Tracking ID (Order ID)",
    keys: [
      "order_id",
      "orderid",
      "tracking_id",
      "trackingid",
      "order_reference",
      "orderreference",
      "trackingorderid",
    ],
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

// Extracts the canonical live record fields from a normalized key/value map, returning
// null when the required data is missing.
const buildLiveRecordFromMap = (map: Map<string, string>): LiveRecord | null => {
  if (!map || map.size === 0) return null;
  return buildLiveRecord((keys) => getValueFromMap(map, keys));
};

// Combines operator-selected values with the broader OCR extraction, preferring explicit
// choices but falling back to any available data.
const mergeLiveRecords = (primary: LiveRecord | null, secondary: LiveRecord | null): LiveRecord | null => {
  if (!primary && !secondary) return null;
  if (!secondary) return primary;
  if (!primary) return secondary;

  const merged: LiveRecord = { ...secondary };
  (Object.keys(merged) as Array<keyof LiveRecord>).forEach((key) => {
    const primaryValue = primary[key];
    const fallbackValue = secondary[key];
    merged[key] = primaryValue && primaryValue.trim() ? primaryValue : fallbackValue;
  });
  const hasValue = Object.values(merged).some((value) => Boolean(value && value.trim()));
  return hasValue ? merged : null;
};

export default function ScannerDashboard() {
  const [file, setFile] = useState<File | null>(null);
  const [kv, setKv] = useState<KvPairs | null>(null);
  const [selectedKv, setSelectedKv] = useState<KvPairs | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [barcodes, setBarcodes] = useState<string[]>([]);
  const [barcodeWarnings, setBarcodeWarnings] = useState<string[]>([]);
  const [barcodeComparison, setBarcodeComparison] = useState<BarcodeComparisonReport | null>(null);
  const [validation, setValidation] = useState<BarcodeValidation | null>(null);
  const [barcodeValidationEnabled, setBarcodeValidationEnabled] = useState(true);
  const [liveRecord, setLiveRecordState] = useState<LiveRecord | null>(null);
  const [bookingWarning, setBookingWarning] = useState<string | null>(null);
  const [bookingSuccess, setBookingSuccess] = useState<string | null>(null);
  const [bookingLocated, setBookingLocated] = useState(false);
  const [vlmInfo, setVlmInfo] = useState<ProviderInfo | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [writingStorage, setWritingStorage] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [checkingBooking, setCheckingBooking] = useState(false);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState<number>(DEFAULT_REFRESH_MS);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeScanControllerRef = useRef<AbortController | null>(null);

  const toggleBarcodeValidation = useCallback(() => {
    setBarcodeValidationEnabled((prev) => !prev);
  }, []);

  // Rehydrate any persisted dashboard state from localStorage so a refresh does not lose
  // the operator's context while demoing or debugging.
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
        const normalizedWarning = typeof maybeWarning === "string" ? maybeWarning : null;
        setBookingWarning(normalizedWarning);

        const maybeSuccess = (parsed as { bookingSuccess?: unknown }).bookingSuccess;
        const normalizedSuccess = typeof maybeSuccess === "string" ? maybeSuccess : null;
        setBookingSuccess(normalizedSuccess);

        const maybeLocated = (parsed as { bookingLocated?: unknown }).bookingLocated;
        if (typeof maybeLocated === "boolean") {
          setBookingLocated(maybeLocated);
        } else if (normalizedSuccess && normalizedSuccess.trim().length > 0) {
          setBookingLocated(true);
        } else if (normalizedWarning && normalizedWarning.trim().length > 0) {
          setBookingLocated(false);
        }

        const maybeProviderInfo = (parsed as { providerInfo?: unknown }).providerInfo;
        setVlmInfo(sanitizeProviderInfo(maybeProviderInfo));

        const maybeKv = (parsed as { kv?: unknown }).kv;
        if (maybeKv && typeof maybeKv === "object" && !Array.isArray(maybeKv)) {
          setKv(maybeKv as KvPairs);
        }

        const maybeSelectedRaw =
          (parsed as { selectedKv?: unknown }).selectedKv ??
          (parsed as { selected_kv?: unknown }).selected_kv ??
          (parsed as { selectedKeyValues?: unknown }).selectedKeyValues ??
          (parsed as { selected_key_values?: unknown }).selected_key_values ??
          null;
        if (maybeSelectedRaw && typeof maybeSelectedRaw === "object" && !Array.isArray(maybeSelectedRaw)) {
          setSelectedKv(maybeSelectedRaw as KvPairs);
        } else {
          setSelectedKv(null);
        }

        const maybeBarcodes = (parsed as { barcodes?: unknown }).barcodes;
        setBarcodes(Array.isArray(maybeBarcodes) ? maybeBarcodes.filter((v) => typeof v === "string") : []);

        const maybeBarcodeWarnings = (parsed as { barcodeWarnings?: unknown }).barcodeWarnings;
        setBarcodeWarnings(
          Array.isArray(maybeBarcodeWarnings)
            ? maybeBarcodeWarnings.filter((v) => typeof v === "string")
            : [],
        );

        const maybeBarcodeComparison = (parsed as { barcodeComparison?: unknown }).barcodeComparison;
        setBarcodeComparison(sanitizeBarcodeComparison(maybeBarcodeComparison));

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

        const maybeBarcodeEnabled = (parsed as { barcodeValidationEnabled?: unknown }).barcodeValidationEnabled;
        if (typeof maybeBarcodeEnabled === "boolean") {
          setBarcodeValidationEnabled(maybeBarcodeEnabled);
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

  // Persist current dashboard selections so the UI feels stateful across reloads.
  useEffect(() => {
    if (!hasHydrated || typeof window === "undefined") return;
    try {
      const payload = {
        status,
        bookingWarning,
        bookingSuccess,
        providerInfo: vlmInfo,
        kv,
        selectedKv,
        barcodes,
        barcodeWarnings,
        barcodeComparison,
        validation,
        barcodeValidationEnabled,
        refreshIntervalMs,
        bookingLocated,
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
    selectedKv,
    barcodes,
    barcodeWarnings,
    barcodeComparison,
    validation,
    vlmInfo,
    bookingLocated,
    barcodeValidationEnabled,
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

  const hasCancelableScan = useMemo(() => loading || isCancelling, [loading, isCancelling]);

  const comparisonRows = useMemo(() => {
    const treatAsDisabled = validation?.status === "disabled";
    if (barcodeComparison && Array.isArray(barcodeComparison.rows) && barcodeComparison.rows.length > 0) {
      if (treatAsDisabled) {
        return barcodeComparison.rows.map((row) => ({ ...row, status: "DISABLED" as ComparisonStatus }));
      }
      return barcodeComparison.rows;
    }
    if (!kv) return [] as BarcodeComparisonRow[];
    return Object.entries(kv).map(([rawKey, rawVal]) => ({
      key: rawKey,
      ocr: String(rawVal ?? ""),
      barcodeLabel: "",
      barcodeValue: "",
      status: (treatAsDisabled ? "DISABLED" : "MISSING") as ComparisonStatus,
      contextLabel: undefined,
    }));
  }, [barcodeComparison, kv, validation]);

  const barcodeOnlyEntries = useMemo(() => {
    if (!barcodeComparison) return [] as BarcodeOnlyEntry[];
    const candidates = Array.isArray(barcodeComparison.library?.missedByOcr)
      ? barcodeComparison.library.missedByOcr
      : [];
    return candidates.filter((entry) => {
      if (!entry) return false;
      const hasLabel = Array.isArray(entry.labels) && entry.labels.some((label) => typeof label === "string" && label.trim().length > 0);
      const hasValue = typeof entry.value === "string" && entry.value.trim().length > 0;
      return hasLabel || hasValue;
    });
  }, [barcodeComparison]);

  // Pulls the most recent booking record from the orders API and keeps the live buffer in
  // sync with server state. When "sync" is requested we trigger the upstream poller.
  const fetchLiveBuffer = useCallback(async (options?: { sync?: boolean }) => {
    try {
      const query = options?.sync ? "?sync=true" : "";
      const response = await apiFetch(`/api/orders${query}`, { cache: "no-store" });
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
        setBookingLocated(false);
      }
    } catch (error) {
      console.error("Failed to load live buffer", error);
    }
  }, [mapApiRecordToLive, updateLiveRecord, setBookingLocated]);

  useEffect(() => {
    fetchLiveBuffer(bookingLocated ? { sync: true } : undefined);
  }, [fetchLiveBuffer, bookingLocated]);

  useEffect(() => {
    if (!bookingLocated || !refreshIntervalMs || typeof window === "undefined") return;
    const id = window.setInterval(() => {
      fetchLiveBuffer({ sync: true });
    }, refreshIntervalMs);
    return () => window.clearInterval(id);
  }, [refreshIntervalMs, fetchLiveBuffer, bookingLocated]);

  const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "my-secret-api-key";

  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  const openCamera = useCallback(() => {
    setCameraError(null);
    setIsCameraOpen(true);
  }, []);

  const handleCameraLoaded = useCallback(() => {
    setCameraReady(true);
  }, []);

  useEffect(() => {
    if (!isCameraOpen) {
      stopCameraStream();
      return;
    }

    setCameraReady(false);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera is not supported in this environment.");
      return;
    }

    let cancelled = false;
    setCameraError(null);

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          try {
            await video.play();
          } catch (error) {
            console.warn("Unable to autoplay camera stream", error);
          }
        }
      } catch (error) {
        console.error("Failed to access camera", error);
        let message = "Unable to access the camera. Check permissions and try again.";
        if (error instanceof DOMException) {
          if (error.name === "NotAllowedError") {
            message = "Camera access was blocked. Please allow permission and try again.";
          } else if (error.message) {
            message = error.message;
          }
        } else if (error instanceof Error && error.message) {
          message = error.message;
        }
        setCameraError(message);
        stopCameraStream();
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      stopCameraStream();
    };
  }, [isCameraOpen, stopCameraStream]);

  const allKvMap = useMemo(() => toNormalizedMap(kv), [kv]);
  const selectedMap = useMemo(() => toNormalizedMap(selectedKv), [selectedKv]);

  const getBufferValue = useCallback((keys: string[]) => getValueFromMap(allKvMap, keys), [allKvMap]);

  const bufferDestination = useMemo(() => {
    if (!LIVE_BUFFER_FIELDS[0]) return "";
    return getBufferValue(LIVE_BUFFER_FIELDS[0].keys);
  }, [getBufferValue]);

  const selectedLiveRecord = useMemo(() => buildLiveRecordFromMap(selectedMap), [selectedMap]);
  const fallbackLiveRecord = useMemo(() => buildLiveRecordFromMap(allKvMap), [allKvMap]);
  const mergedLiveRecord = useMemo(
    () => mergeLiveRecords(selectedLiveRecord, fallbackLiveRecord),
    [selectedLiveRecord, fallbackLiveRecord],
  );
  const hasSourceData = selectedMap.size > 0 || allKvMap.size > 0;

  const activeDestination =
    (liveRecord?.destination && liveRecord.destination.trim()) ||
    (bufferDestination && bufferDestination.trim()) ||
    "";

  useEffect(() => {
    if (!hasSourceData) return;
    if (!mergedLiveRecord) {
      updateLiveRecord(null);
      return;
    }
    updateLiveRecord(mergedLiveRecord);
  }, [hasSourceData, mergedLiveRecord, updateLiveRecord]);

  // Resets the dashboard when a new document is selected so stale extraction data is not
  // displayed while the next scan runs.
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFile(f ?? null);
    setCapturedImage(null);
    setIsCameraOpen(false);
    stopCameraStream();
    setCameraError(null);
    setKv(null);
    setSelectedKv(null);
    setStatus(null);
    setBarcodes([]);
    setBarcodeWarnings([]);
    setValidation(null);
    setBookingWarning(null);
    setBookingLocated(false);
  };

  // Uploads a file to the OCR endpoint and hydrates the dashboard with the extracted
  // structured data and barcode comparison results.
  const runScan = useCallback(
    async (targetFile: File) => {
      const controller = new AbortController();
      activeScanControllerRef.current?.abort();
      activeScanControllerRef.current = controller;
      setLoading(true);
      setStatus("Uploading file and scanning…");
      setVlmInfo(null);
      try {
        const formData = new FormData();
        formData.append("file", targetFile);
        formData.append("barcodeDisabled", barcodeValidationEnabled ? "false" : "true");

        const res = await apiFetch("/api/ocr", {
          method: "POST",
          headers: { "x-api-key": API_KEY },
          body: formData,
          signal: controller.signal,
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
          setSelectedKv(null);
          setBarcodes([]);
          setBarcodeWarnings([]);
          setBarcodeComparison(null);
          setValidation(null);
          setBookingWarning(null);
          setBookingSuccess(null);
          setVlmInfo(nextProviderInfo ?? null);
          updateLiveRecord(null);
          setBookingLocated(false);
          return;
        }

        const kvPayload = data.kv && typeof data.kv === "object" ? (data.kv as KvPairs) : {};
        const rawSelected = data.selectedKv ?? (data as { selected_key_values?: unknown }).selected_key_values ?? null;
        const selectedPayload =
          rawSelected && typeof rawSelected === "object" && !Array.isArray(rawSelected) ? (rawSelected as KvPairs) : {};

        setKv(kvPayload);
        setSelectedKv(selectedPayload);
        setBarcodes(Array.isArray(data.barcodes) ? data.barcodes : []);
        setBarcodeWarnings(Array.isArray(data.barcodeWarnings) ? data.barcodeWarnings : []);
        setBarcodeComparison(sanitizeBarcodeComparison(data.barcodeComparison));
        setValidation(toClientValidation(data.validation));

        const statusFromValidation: Record<ValidationStatus, string> = {
          match: "Barcode and OCR values align. Checking database…",
          mismatch: data.validation?.message || "Barcode and OCR values mismatch.",
          no_barcode: "No barcode detected; continuing with OCR results.",
          missing_item_code: "Barcode detected but OCR did not yield an item code.",
          disabled: "Barcode validation disabled; continuing with OCR results.",
        };

        const vStatus = data.validation?.status;
        if (vStatus) setStatus(statusFromValidation[vStatus]);

        const normalizedAllMap = toNormalizedMap(kvPayload);
        const normalizedSelectedMap = toNormalizedMap(selectedPayload);
        const recordCandidate = mergeLiveRecords(
          buildLiveRecordFromMap(normalizedSelectedMap),
          buildLiveRecordFromMap(normalizedAllMap),
        );

        if (recordCandidate) {
          updateLiveRecord(recordCandidate);
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
            setBookingLocated(false);
          } else {
            const trackingIdForStatus = recordCandidate.trackingId;
            setStatus(`Logging scan for ${trackingIdForStatus}…`);
            setBookingWarning(null);
            setBookingSuccess(null);
            const response = await apiFetch(`/api/orders`, {
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
              signal: controller.signal,
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
                setBookingLocated(false);
              } else if (trackedId) {
                setBookingSuccess(`Booked item found for ${trackedId}`);
                setBookingLocated(true);
              } else {
                setBookingSuccess("Booked item found");
                setBookingLocated(true);
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
        } else {
          updateLiveRecord(null);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        if ((err as { name?: string })?.name === "AbortError") {
          return;
        }
        console.error(err);
        setStatus(formatStatusError(err));
        setBookingWarning(null);
        setBookingSuccess(null);
        setVlmInfo(null);
      } finally {
        if (activeScanControllerRef.current === controller) {
          activeScanControllerRef.current = null;
          setLoading(false);
        }
      }
    },
    [API_KEY, barcodeValidationEnabled, mapApiRecordToLive, updateLiveRecord],
  );

  // Convenience wrapper so existing UI hooks can trigger the scan based on the selected
  // file state when uploading from disk.
  const scanDocument = useCallback(async () => {
    if (!file) return;
    await runScan(file);
  }, [file, runScan]);

  const handleCapture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      setStatus("Camera is still starting. Please try again in a moment.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      setStatus("Unable to capture an image from the camera feed.");
      return;
    }
    context.drawImage(video, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((result) => resolve(result), "image/jpeg", 0.7),
    );
    if (!blob) {
      setStatus("Unable to capture an image from the camera feed.");
      return;
    }

    const previewDataUrl = canvas.toDataURL("image/jpeg", 0.85);
    if (previewDataUrl) {
      setCapturedImage(previewDataUrl);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const capturedFile = new File([blob], `camera-capture-${timestamp}.jpg`, {
      type: blob.type || "image/jpeg",
    });

    setCameraError(null);
    setFile(capturedFile);
    setIsCameraOpen(false);
    stopCameraStream();
    await runScan(capturedFile);
  }, [runScan, stopCameraStream]);

  // Seeds the UI with canned manifest data so demos can run without an actual camera feed.
  const handleDemoScan = () => {
    const sample = DEMO_RECORDS[Math.floor(Math.random() * DEMO_RECORDS.length)];
    setFile(null);
    setCapturedImage(null);
    setIsCameraOpen(false);
    setCameraError(null);
    stopCameraStream();
    setKv(sample);
    setSelectedKv({
      Destination: toDisplayString(sample.destination_warehouse_id),
      "Item Name": toDisplayString(sample.item_name),
      "Tracking/Order ID": toDisplayString(sample.tracking_id ?? sample.item_code),
      "Truck Number": toDisplayString(sample.truck_number),
      "Ship Date": toDisplayString(sample.ship_date),
      "Expected Departure Time": toDisplayString(sample.expected_departure_time),
      Origin: toDisplayString(sample.origin),
    });
    setStatus("Demo scan loaded into the live buffer.");
    setBarcodes([]);
    setBarcodeWarnings([]);
    setBarcodeComparison(null);
    setValidation(null);
    setBookingWarning(null);
    setBookingSuccess(null);
    setVlmInfo(null);
  };

  const handleCancelScan = useCallback(async () => {
    if (isCancelling || !hasCancelableScan) {
      return;
    }

    const trackingId = liveRecord?.trackingId?.trim();
    const cancellingMessage = trackingId
      ? `Cancelling scan for ${trackingId}…`
      : "Cancelling scan…";
    setIsCancelling(true);
    setStatus(cancellingMessage);

    try {
      let fallbackRecord: LiveRecord | null = null;
      if (trackingId) {
        const params = new URLSearchParams({ trackingId });
        const response = await apiFetch(`/api/orders?${params.toString()}`, { method: "DELETE" });
        const payload: { liveBuffer?: ApiLiveBufferRecord[]; error?: string } = await response
          .json()
          .catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload.error === "string" ? payload.error : response.statusText);
        }
        const records = Array.isArray(payload.liveBuffer) ? payload.liveBuffer : [];
        if (records.length > 0) {
          fallbackRecord = mapApiRecordToLive(records[0]);
        }
      }

      updateLiveRecord(fallbackRecord);
      setFile(null);
      setCapturedImage(null);
      setIsCameraOpen(false);
      stopCameraStream();
      setCameraReady(false);
      setCameraError(null);
      setLoading(false);
      setCheckingBooking(false);
      setKv(null);
      setSelectedKv(null);
      setBarcodes([]);
      setBarcodeWarnings([]);
      setBarcodeComparison(null);
      setValidation(null);
      setBookingWarning(null);
      setBookingSuccess(null);
      setBookingLocated(false);
      setStorageError(null);
      setVlmInfo(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      activeScanControllerRef.current?.abort();
      activeScanControllerRef.current = null;

      const fallbackStatus = fallbackRecord?.trackingId?.trim()
        ? `Scan cancelled. Showing live buffer for ${fallbackRecord.trackingId}.`
        : "Scan cancelled.";
      setStatus(fallbackStatus);
    } catch (error) {
      console.error("Failed to cancel scan", error);
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Failed to cancel scan.";
      setStatus(message);
    } finally {
      setIsCancelling(false);
    }
  }, [
    isCancelling,
    hasCancelableScan,
    liveRecord,
    mapApiRecordToLive,
    updateLiveRecord,
    stopCameraStream,
  ]);

  // Requeries the booking service for the active tracking ID to confirm if a dock assignment
  // exists and updates status messaging accordingly.
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
      const response = await apiFetch(`/api/orders?${params.toString()}`, { cache: "no-store" });
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
        setBookingLocated(true);
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
        setBookingLocated(false);
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

  // Lets operators control how aggressively the dashboard re-polls bookings after a match
  // has been confirmed.
  const handleRefreshIntervalChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const rawValue = Number(event.target.value);
      if (!bookingLocated) return;
      if (Number.isFinite(rawValue) && rawValue > 0) {
        setRefreshIntervalMs(rawValue);
        fetchLiveBuffer({ sync: true });
      }
    },
    [fetchLiveBuffer, bookingLocated],
  );

  // Persists the current live record to the storage API, simulating a downstream system
  // update when operators confirm the extracted data.
  const handleWriteStorage = async () => {
    if (!liveRecord || writingStorage) return;
    try {
      setWritingStorage(true);
      setStorageError(null);
      const response = await apiFetch("/api/storage", {
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
      const payload: { error?: string } = await response
        .json()
        .catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : response.statusText);
      }
      setStatus(`Storage updated for ${liveRecord.trackingId}.`);
      setStorageError(null);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Failed to write storage.";
      const normalizedMessage = message && message.trim().length > 0 ? message.trim() : "Failed to write storage.";
      setStatus(normalizedMessage);
      setStorageError(normalizedMessage);
    } finally {
      setWritingStorage(false);
    }
  };

  // Clears the live buffer on the API and resets UI context so operators can start a fresh
  // scan session without stale data leaking through.
  const handleClearLive = async () => {
    try {
      const response = await apiFetch("/api/orders", { method: "DELETE" });
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
      setSelectedKv(null);
      setBarcodes([]);
      setBarcodeWarnings([]);
      setValidation(null);
      setStatus("Live buffer cleared.");
      setBookingWarning(null);
      setBookingSuccess(null);
      setVlmInfo(null);
      setBookingLocated(false);
      setStorageError(null);
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
            <button
              type="button"
              role="switch"
              aria-checked={barcodeValidationEnabled}
              onClick={toggleBarcodeValidation}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${
                barcodeValidationEnabled
                  ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200/90 hover:bg-emerald-500/20"
                  : "border-slate-400/40 bg-slate-500/10 text-slate-200/80 hover:bg-slate-500/20"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  barcodeValidationEnabled ? "bg-emerald-400" : "bg-slate-300"
                }`}
              />
              {barcodeValidationEnabled ? "Barcode validation on" : "Barcode validation off"}
            </button>
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
            <p className="mt-2 text-sm text-slate-400">PNG, JPG, or other images up to 10MB</p>
            <div className="mt-6 space-y-4 text-left">
              <Input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="cursor-pointer"
              />
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
            <h3 className="mt-6 text-lg font-semibold text-slate-100">Capture with camera</h3>
            <p className="mt-2 text-sm text-slate-400">
              Open your device camera, snap an order sheet, and send it through the same OCR pipeline instantly.
            </p>
            <div className="mt-6 space-y-4 text-left">
              {!isCameraOpen && capturedImage && (
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                  <img
                    src={capturedImage}
                    alt="Last captured order sheet preview"
                    className="h-56 w-full object-cover"
                  />
                </div>
              )}
              {isCameraOpen ? (
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                    <video
                      ref={videoRef}
                      className="h-56 w-full object-cover"
                      muted
                      playsInline
                      autoPlay
                      onLoadedMetadata={handleCameraLoaded}
                    />
                  </div>
                  {cameraError && (
                    <p className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                      {cameraError}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <Button
                      type="button"
                      variant="secondary"
                      className="flex-1 justify-center"
                      onClick={() => setIsCameraOpen(false)}
                      disabled={loading}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      className="flex-1 justify-center"
                      onClick={handleCapture}
                      disabled={!cameraReady || loading}
                    >
                      {loading ? "Scanning…" : cameraReady ? "Capture & scan" : "Starting camera…"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {cameraError && (
                    <p className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                      {cameraError}
                    </p>
                  )}
                  <Button
                    type="button"
                    onClick={openCamera}
                    className="w-full justify-center"
                    disabled={loading}
                  >
                    Launch camera
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleDemoScan}
                    className="w-full justify-center"
                    disabled={loading}
                  >
                    Use sample data
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
        {hasCancelableScan && (
          <div className="mt-6 flex justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancelScan}
              disabled={isCancelling}
              className="w-full justify-center sm:w-auto"
            >
              {isCancelling ? "Cancelling…" : "Cancel scan"}
            </Button>
          </div>
        )}
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
          <dl className="mt-3 grid gap-4 sm:grid-cols-4">
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
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-300/70">Execution path</dt>
              <dd className="mt-1 text-base text-slate-100/90">
                {describeExecutionMode(vlmInfo)}
                {vlmInfo.executionDebug && vlmInfo.executionDebug.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-slate-300/80">
                    {vlmInfo.executionDebug.map((entry, index) => (
                      <li key={`${entry}-${index}`} className="break-words">
                        {entry}
                      </li>
                    ))}
                  </ul>
                )}
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
                {comparisonRows.map((row, index) => {
                  const meta = COMPARISON_STATUS_META[row.status] ?? COMPARISON_STATUS_META.MISSING;
                  const hasBarcodeValue = row.barcodeValue && row.barcodeValue.trim().length > 0;
                  const contextLabel = row.contextLabel || row.barcodeLabel;
                  return (
                    <tr key={`${row.key}-${index}`} className="border-b border-white/10 last:border-0">
                      <td className="px-4 py-3 font-medium text-slate-100">{row.key}</td>
                      <td className="px-4 py-3 text-slate-200">{row.ocr}</td>
                      <td className={`px-4 py-3 ${hasBarcodeValue ? "text-slate-200" : "text-slate-500"}`}>
                        {hasBarcodeValue ? (
                          <div className="flex flex-col">
                            <span>{row.barcodeValue}</span>
                            {contextLabel && (
                              <span className="text-xs uppercase tracking-wide text-slate-400/80">{contextLabel}</span>
                            )}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-flex items-center justify-end gap-2 text-sm ${meta.className}`}>
                          <span aria-hidden>{meta.symbol}</span>
                          <span className="text-xs uppercase tracking-wide">{meta.label}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {barcodeComparison && (
            <p className="mt-4 text-xs text-slate-300">
              Comparison summary: {barcodeComparison.summary.matched} match{barcodeComparison.summary.matched === 1 ? "" : "es"}, {barcodeComparison.summary.mismatched} mismatch{barcodeComparison.summary.mismatched === 1 ? "" : "es"}, {barcodeComparison.summary.missing} missing.
            </p>
          )}

          {barcodeOnlyEntries.length > 0 && (
            <div className="mt-6 rounded-2xl border border-indigo-400/20 bg-indigo-500/5 p-4">
              <div className="flex flex-col gap-1 text-sm text-slate-100">
                <span className="font-semibold uppercase tracking-[0.3em] text-indigo-200/80">
                  Barcode-only values
                </span>
                <p className="text-xs text-slate-300/90">
                  These values were detected in the barcode payload but were not matched to any OCR keys. Review them to see if
                  the OCR output is missing required fields.
                </p>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-white/5 text-left font-medium uppercase tracking-wide text-slate-300/80">
                    <tr>
                      <th className="px-3 py-2">Labels</th>
                      <th className="px-3 py-2">Value</th>
                      <th className="px-3 py-2">Class</th>
                      <th className="px-3 py-2 text-right">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {barcodeOnlyEntries.map((entry, index) => {
                      const displayLabels = entry.labels && entry.labels.length > 0
                        ? entry.labels.filter((label) => label.trim().length > 0).join(", ") || "(unlabeled)"
                        : "(unlabeled)";
                      return (
                        <tr key={`${entry.value}-${index}`} className="border-b border-white/10 last:border-0">
                          <td className="px-3 py-2 text-slate-200">{displayLabels}</td>
                          <td className="px-3 py-2 text-slate-100">{entry.value && entry.value.trim().length > 0 ? entry.value : "—"}</td>
                          <td className="px-3 py-2 text-slate-300/90">{entry.class?.trim() || "unknown"}</td>
                          <td className="px-3 py-2 text-right text-slate-200">{entry.count && entry.count > 0 ? entry.count : 1}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

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
              {bookingLocated && (
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
              )}
            </div>
          }
          footer={
            <div className="flex flex-wrap justify-end gap-3">
              <Button onClick={handleWriteStorage} disabled={!liveRecord || writingStorage}>
                {writingStorage ? "Writing…" : "Write to storage"}
              </Button>
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

      {storageError && (
        <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-500/5 px-6 py-4 text-sm text-rose-200 sm:px-8">
          <p className="font-medium text-rose-100">{storageError}</p>
        </div>
      )}


      <FloorMapViewer activeDestination={activeDestination || undefined} />
    </div>
  );
}

