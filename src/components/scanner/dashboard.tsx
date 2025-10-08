"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import FloorMapModule from "@/components/maps/floor-map-module";
import {
  LiveRecord,
  loadLiveRecord,
  persistLiveRecord,
  pushHistoryRecord,
  writeRecordToStorage,
} from "@/lib/localStorage";

interface KvPairs {
  [key: string]: any;
}

interface Order {
  id: number;
  code: string;
  data: any;
  collected: number;
  floor: string;
  section: string;
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
}

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
const normVal = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

const BARCODE_FIELD_TITLES = [
  "Product Name",
  "Truck ID",
  "Date",
  "Current Warehouse ID",
  "Destination Warehouse ID",
  "Estimated Departure Time",
  "Estimated Arrival Time",
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
  set(["Shipping Dock ID", "dock", "dock_id"], "Shipping Dock ID");
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

function parseBarcodeText(barcodes: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (!barcodes?.length) return map;

  const text = barcodes.join(" ").replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();

  type Hit = { name: string; start: number };
  const hits: Hit[] = [];
  for (const title of BARCODE_FIELD_TITLES) {
    const idx = lower.indexOf(title.toLowerCase());
    if (idx >= 0) hits.push({ name: title, start: idx });
  }
  hits.sort((a, b) => a.start - b.start);

  for (let i = 0; i < hits.length; i++) {
    const cur = hits[i];
    const next = hits[i + 1];
    const start = cur.start + cur.name.length;
    const end = next ? next.start : text.length;
    let value = text.slice(start, end).trim();
    value = value.replace(/^[:\-–—\s]+/, "").trim();
    if (value) map.set(normalizeKey(cur.name), value);
  }
  return map;
}

function pickBestBarcodeId(barcodeKv: Map<string, string>): string | null {
  for (const k of PREFERRED_ID_KEYS) {
    const v = barcodeKv.get(k);
    if (v && v.trim()) return v.trim();
  }
  return null;
}

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
  const [order, setOrder] = useState<Order | null>(null);
  const [floor, setFloor] = useState("");
  const [section, setSection] = useState("");
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [barcodes, setBarcodes] = useState<string[]>([]);
  const [barcodeWarnings, setBarcodeWarnings] = useState<string[]>([]);
  const [validation, setValidation] = useState<BarcodeValidation | null>(null);
  const [liveRecord, setLiveRecordState] = useState<LiveRecord | null>(null);
  const [scanToken, setScanToken] = useState(0);

  useEffect(() => {
    setLiveRecordState(loadLiveRecord());
  }, []);

  const updateLiveRecord = useCallback((record: LiveRecord | null) => {
    setLiveRecordState(record);
    persistLiveRecord(record);
  }, []);

  const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "my-secret-api-key";

  const ocrKv = useMemo(() => {
    const m = new Map<string, string>();
    if (!kv) return m;
    const toStr = (v: any) =>
      v == null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v);
    for (const [k, v] of Object.entries(kv)) m.set(normalizeKey(k), toStr(v));
    return m;
  }, [kv]);

  const barcodeKv = useMemo(() => parseBarcodeText(barcodes), [barcodes]);

  const getBarcodeValueForOcrKey = (normalizedOcrKey: string): string | null => {
    const mapped = OCR_TO_BARCODE_KEY[normalizedOcrKey];
    if (mapped) {
      const v = barcodeKv.get(mapped);
      if (v && v.trim()) return v.trim();
    }
    if (ID_LIKE_SET.has(normalizedOcrKey)) {
      const id = pickBestBarcodeId(barcodeKv);
      if (id) return id;
    }
    return null;
  };

  const getRowMatch = (ocrValue: string, barcodeValue: string | null) => {
    if (!barcodeValue) return { symbol: "–", label: "Not compared", className: "text-gray-400" };
    if (normVal(ocrValue) === normVal(barcodeValue)) {
      return { symbol: "✓", label: "Match", className: "text-green-600" };
    }
    return { symbol: "✗", label: "Mismatch", className: "text-red-600" };
  };

  const getBufferValue = (keys: string[]) => {
    for (const k of keys) {
      const v = ocrKv.get(normalizeKey(k));
      if (v && v.trim()) return v.trim();
    }
    return "";
  };

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
    setOrder(null);
    setStatus(null);
    setBarcodes([]);
    setBarcodeWarnings([]);
    setValidation(null);
  };

  const scanDocument = async () => {
    if (!file) return;
    setLoading(true);
    setStatus("Uploading file and scanning…");
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "x-api-key": API_KEY },
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());

      const data: ApiOcrResponse = await res.json();

      setKv(data.kv || {});
      setScanToken((token) => token + 1);
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

      const code = data.kv?.item_code;
      if (code && (!vStatus || vStatus === "match")) {
        setStatus(`Extracted item code ${code}. Checking database…`);
        const resOrder = await fetch(`/api/orders?code=${encodeURIComponent(code)}`, {
          headers: { "x-api-key": API_KEY },
        });
        if (resOrder.ok) {
          const json = await resOrder.json();
          if (json.order) {
            setOrder(json.order as Order);
            setFloor(json.order.floor);
            setSection(json.order.section);
            setStatus(`Order ${code} found.`);
          } else {
            setOrder(null);
            setFloor("");
            setSection("");
            setStatus(`Order ${code} not found. You can add it below.`);
          }
        }
      }

      if (!data.kv?.item_code && !vStatus) {
        setStatus("No item code extracted.");
      }
    } catch (err) {
      console.error(err);
      setStatus("Error scanning document.");
    } finally {
      setLoading(false);
    }
  };

  const handleDemoScan = () => {
    const sample = DEMO_RECORDS[Math.floor(Math.random() * DEMO_RECORDS.length)];
    setFile(null);
    setKv(sample);
    setOrder(null);
    setStatus("Demo scan loaded into the live buffer.");
    setBarcodes([]);
    setBarcodeWarnings([]);
    setValidation(null);
    setScanToken((token) => token + 1);
  };

  const createNewOrder = async () => {
    if (!kv) return;
    const code = kv.item_code;
    if (!code || !floor || !section) {
      setStatus("Please enter floor and section.");
      return;
    }
    if (validation?.status === "mismatch") {
      setStatus("Resolve the barcode mismatch before creating a new order.");
      return;
    }
    setCreating(true);
    setStatus("Creating order…");
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
        body: JSON.stringify({ code, data: kv, floor, section }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setOrder(json.order as Order);
      setStatus(`Order ${code} created.`);
    } catch (e) {
      console.error(e);
      setStatus("Failed to create order.");
    } finally {
      setCreating(false);
    }
  };

  const markCollected = async () => {
    if (!order) return;
    setStatus("Marking as collected…");
    try {
      const res = await fetch("/api/orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
        body: JSON.stringify({ code: order.code, collected: true }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setOrder(json.order as Order);
      setStatus(`Order ${order.code} marked as collected.`);
    } catch (e) {
      console.error(e);
      setStatus("Failed to mark order.");
    }
  };

  const handleSaveHistory = () => {
    if (!liveRecord) return;
    pushHistoryRecord(liveRecord);
    setStatus("Saved to history.");
  };

  const handleWriteStorage = () => {
    if (!liveRecord) return;
    writeRecordToStorage(liveRecord);
    setStatus("Written to storage.");
  };

  const handleClearLive = () => {
    updateLiveRecord(null);
    setStatus("Live buffer cleared.");
  };

  return (
    <div className="space-y-8">
      <section className="rounded-lg bg-white shadow-md">
        <div className="border-b border-gray-200 px-6 py-5">
          <h2 className="text-xl font-semibold text-gray-900">Scan Order Sheet</h2>
          <p className="mt-1 text-sm text-gray-500">
            Upload or capture an image of your order sheet to extract data. The camera demo loads sample data to explore the
            workflow quickly.
          </p>
        </div>
        <div className="px-6 py-6">
          <div className="flex flex-col gap-6 md:flex-row">
            <div className="flex-1">
              <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center transition hover:border-blue-500">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-500">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M4 8V7a3 3 0 013-3h10a3 3 0 013 3v1M12 12v9m0-9l3 3m-3-3l-3 3" />
                  </svg>
                </div>
                <h3 className="mt-3 text-base font-semibold text-gray-900">Upload Order Sheet</h3>
                <p className="mt-1 text-sm text-gray-500">PNG, JPG, PDF up to 10MB</p>
                <div className="mt-6 space-y-4">
                  <Input type="file" accept="image/*,application/pdf" onChange={handleFileChange} />
                  <Button className="w-full hover:cursor-pointer" onClick={scanDocument} disabled={!file || loading}>
                    {loading ? "Scanning…" : "Scan Document"}
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-center">
              <span className="text-sm font-semibold text-gray-400">OR</span>
            </div>
            <div className="flex-1">
              <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center transition hover:border-blue-500">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-500">
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h4l2-2h4l2 2h4v12H4z" />
                  </svg>
                </div>
                <h3 className="mt-3 text-base font-semibold text-gray-900">Capture Image</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Use your device camera to scan. The demo button seeds the latest scan with curated sample data.
                </p>
                <div className="mt-6">
                  <Button className="hover:cursor-pointer" type="button" onClick={handleDemoScan}>
                    Open Camera (Demo)
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {status && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          <span className="font-semibold">Status:</span> {status}
        </div>
      )}

      {kv && (
        <Card header={<span className="font-medium text-gray-900">Extracted OCR &amp; Barcode Data</span>} className="bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Field</th>
                  <th className="px-3 py-2">OCR Value</th>
                  <th className="px-3 py-2">Barcode Value</th>
                  <th className="px-3 py-2 text-right">Match</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(kv).map(([rawKey, rawVal]) => {
                  const ocrKey = normalizeKey(rawKey);
                  const ocrValue = String(rawVal ?? "");
                  const barcodeValue = getBarcodeValueForOcrKey(ocrKey);
                  const match = getRowMatch(ocrValue, barcodeValue);

                  return (
                    <tr key={rawKey} className="border-b border-gray-200 last:border-0">
                      <td className="px-3 py-2 font-medium text-gray-900">{rawKey}</td>
                      <td className="px-3 py-2 text-gray-700">{ocrValue}</td>
                      <td className={`px-3 py-2 ${barcodeValue ? "text-gray-700" : "text-gray-400"}`}>
                        {barcodeValue ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
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
              className={`mt-3 text-xs ${
                validation.status === "mismatch"
                  ? "text-red-600"
                  : validation.status === "match"
                  ? "text-green-600"
                  : "text-gray-500"
              }`}
            >
              {validation.message}
            </p>
          )}

          {barcodeWarnings.length > 0 && (
            <div className="mt-3 text-xs">
              <p className="font-medium text-gray-700">Warnings</p>
              <ul className="list-inside list-disc text-gray-500">
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
          header={<span className="font-medium text-gray-900">Live Buffer (latest scan)</span>}
          className="bg-white"
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button onClick={handleWriteStorage} className="hover:cursor-pointer">
                Write to Storage
              </Button>
              <Button onClick={handleSaveHistory} className="hover:cursor-pointer" variant="secondary">
                Save to History
              </Button>
              <Button onClick={handleClearLive} className="hover:cursor-pointer" variant="outline">
                Clear Live Buffer
              </Button>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Destination</th>
                  <th className="px-3 py-2">Item Name</th>
                  <th className="px-3 py-2">Tracking ID</th>
                  <th className="px-3 py-2">Truck Number</th>
                  <th className="px-3 py-2">Ship Date</th>
                  <th className="px-3 py-2">Expected Departure Time</th>
                  <th className="px-3 py-2">Origin</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-200">
                  <td className="px-3 py-2 text-gray-700">{liveRecord.destination || "—"}</td>
                  <td className="px-3 py-2 text-gray-700">{liveRecord.itemName || "—"}</td>
                  <td className="px-3 py-2 text-gray-700">{liveRecord.trackingId || "—"}</td>
                  <td className="px-3 py-2 text-gray-700">{liveRecord.truckNumber || "—"}</td>
                  <td className="px-3 py-2 text-gray-700">{liveRecord.shipDate || "—"}</td>
                  <td className="px-3 py-2 text-gray-700">{liveRecord.expectedDepartureTime || "—"}</td>
                  <td className="px-3 py-2 text-gray-700">{liveRecord.origin || "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {kv && (
        <Card header={<span className="font-medium text-gray-900">Live Buffer Fields</span>} className="bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Field</th>
                  <th className="px-3 py-2">Value</th>
                </tr>
              </thead>
              <tbody>
                {LIVE_BUFFER_FIELDS.map(({ label, keys }) => {
                  const v = getBufferValue(keys);
                  const has = Boolean(v && v.trim());
                  return (
                    <tr key={label} className="border-b border-gray-200 last:border-0">
                      <td className="px-3 py-2 font-medium text-gray-900">{label}</td>
                      <td className={`px-3 py-2 ${has ? "text-gray-700" : "text-gray-400"}`}>{has ? v : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {order && (
        <Card header={<span className="font-medium text-gray-900">Order Information</span>} className="bg-white">
          <div className="space-y-2 text-sm text-gray-700">
            <p>
              <span className="font-semibold text-gray-900">Code:</span> {order.code}
            </p>
            <p>
              <span className="font-semibold text-gray-900">Floor:</span> {order.floor}
            </p>
            <p>
              <span className="font-semibold text-gray-900">Section:</span> {order.section}
            </p>
            <p>
              <span className="font-semibold text-gray-900">Collected:</span> {order.collected ? "Yes" : "No"}
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {!order.collected && (
              <Button className="hover:cursor-pointer" onClick={markCollected}>
                Mark as Collected
              </Button>
            )}
          </div>
        </Card>
      )}

      {kv && !order && (
        <Card header={<span className="font-medium text-gray-900">Create Order</span>} className="bg-white">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm text-gray-700">
              <span className="mb-1 block font-medium text-gray-900">Floor</span>
              <Input type="text" value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="e.g. floor1" />
            </label>
            <label className="text-sm text-gray-700">
              <span className="mb-1 block font-medium text-gray-900">Section</span>
              <Input type="text" value={section} onChange={(e) => setSection(e.target.value)} placeholder="e.g. section-a" />
            </label>
          </div>
          <Button
            className="mt-4 hover:cursor-pointer"
            onClick={createNewOrder}
            disabled={creating || validation?.status === "mismatch"}
          >
            {creating ? "Creating…" : "Create Order"}
          </Button>
        </Card>
      )}

      <FloorMapModule
        destinationLabel={liveRecord?.destination || kv?.destination_warehouse_id || ""}
        floorHint={order?.floor || floor}
        sectionHint={order?.section || section}
        lastUpdatedKey={scanToken}
      />
    </div>
  );
}

