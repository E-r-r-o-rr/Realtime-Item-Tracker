// src/app/upload/page.tsx
"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

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

/** Fields present in your barcode string (human labels). */
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

/** Preferred ID selection for comparisons when an OCR row is “ID-like”. */
const PREFERRED_ID_KEYS = [
  "order_id",
  "orderid",
  "tracking_id",
  "trackingid",
  "order_reference",
  "orderreference",
];

/** OCR keys we consider “ID-like”. */
const ID_LIKE_SET = new Set(
  ["order_id", "orderid", "tracking_id", "trackingid", "item_code", "itemcode", "order_reference", "orderreference"].map(
    normalizeKey
  )
);

/** Map OCR key aliases to the corresponding barcode key (normalized). */
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
    "Estimated Departure Time"
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

/** Live Buffer mapping (strict per your spec). */
const LIVE_BUFFER_FIELDS: Array<{ label: string; keys: string[] }> = [
  { label: "Destination", keys: ["destinationwarehouseid", "destination_warehouse_id"] },
  { label: "Item Name", keys: ["item_name", "itemname", "product_name", "productname", "product", "item"] },
  {
    label: "Tracking ID (Order ID)",
    keys: ["order_id", "orderid", "tracking_id", "trackingid", "order_reference", "orderreference"],
  },
  { label: "Truck Number", keys: ["truckid", "truck_id", "truck_number", "trucknumber", "truck_no", "truck"] },
  { label: "Ship Date", keys: ["ship_date", "shipdate", "shipping_date", "date"] },
  {
    label: "Expected Departure Time",
    keys: [
      "estimateddeparturetime",
      "expected_departure_time",
      "expecteddeparturetime",
      "departure_time",
      "etd",
    ],
  },
  {
    label: "Origin (Origin Warehouse)",
    keys: ["currentwarehouseid", "current_warehouse_id", "origin", "origin_warehouse", "originwarehouse"],
  },
];

/** Parse one-line barcode text into a KV map keyed by normalized field title. */
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

/** Pick the “best” ID value (Order ID > Tracking ID > Order Reference) from barcode map. */
function pickBestBarcodeId(barcodeKv: Map<string, string>): string | null {
  for (const k of PREFERRED_ID_KEYS) {
    const v = barcodeKv.get(k);
    if (v && v.trim()) return v.trim();
  }
  return null;
}

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [kv, setKv] = useState<KvPairs | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [floor, setFloor] = useState("");
  const [section, setSection] = useState("");
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [barcodes, setBarcodes] = useState<string[]>([]);
  const [barcodeWarnings, setBarcodeWarnings] = useState<string[]>([]);
  const [validation, setValidation] = useState<BarcodeValidation | null>(null);

  const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "my-secret-api-key";

  /** Normalize OCR KV for easy lookup. */
  const ocrKv = useMemo(() => {
    const m = new Map<string, string>();
    if (!kv) return m;
    const toStr = (v: any) =>
      v == null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v);
    for (const [k, v] of Object.entries(kv)) m.set(normalizeKey(k), toStr(v));
    return m;
  }, [kv]);

  /** Barcode KV. */
  const barcodeKv = useMemo(() => parseBarcodeText(barcodes), [barcodes]);

  /** For each OCR key, find the *matching barcode field* value (not the whole blob). */
  const getBarcodeValueForOcrKey = (normalizedOcrKey: string): string | null => {
    const mapped = OCR_TO_BARCODE_KEY[normalizedOcrKey];
    if (mapped) {
      const v = barcodeKv.get(mapped);
      if (v && v.trim()) return v.trim();
    }
    // If the row is ID-like but no direct mapping found, show the best ID from barcode
    if (ID_LIKE_SET.has(normalizedOcrKey)) {
      const id = pickBestBarcodeId(barcodeKv);
      if (id) return id;
    }
    return null;
  };

  const getRowMatch = (ocrValue: string, barcodeValue: string | null) => {
    if (!barcodeValue) return { symbol: "–", label: "Not compared", className: "text-[var(--color-textSecondary)]" };
    // Normalize both for comparison
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFile(f ?? null);
    setKv(null);
    setOrder(null);
    setMapUrl(null);
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

  const retrieveMap = async () => {
    if (!order && !kv) return;
    const code = order ? order.code : kv?.item_code;
    if (!code) return setStatus("No item code found.");
    setStatus("Resolving map…");
    try {
      const res = await fetch(`/api/items/${code}/map`, { headers: { "x-api-key": API_KEY } });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const mapRes = await fetch(`/api/maps?key=${data.mapKey}`, { headers: { "x-api-key": API_KEY } });
      if (!mapRes.ok) throw new Error(await mapRes.text());
      const blob = await mapRes.blob();
      setMapUrl(URL.createObjectURL(blob));
      setStatus(`Map for ${code} loaded.`);
    } catch (e) {
      console.error(e);
      setStatus("Failed to retrieve map.");
    }
  };

  return (
    <main className="mx-auto max-w-3xl py-10 px-4 space-y-6">
      <h2 className="text-2xl font-semibold">Scan Order Document</h2>

      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Upload PDF or Image</span>
          <Input type="file" accept="image/*,application/pdf" onChange={handleFileChange} />
        </label>
        <Button className="hover:cursor-pointer" onClick={scanDocument} disabled={!file || loading}>
          {loading ? "Scanning…" : "Scan Document"}
        </Button>
      </div>

      {status && <p className="text-sm text-[var(--color-textSecondary)]">{status}</p>}

      {kv && (
        <Card header={<span className="font-medium">Extracted OCR &amp; Barcode Data</span>} className="mt-4 space-y-3">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-borderColor)] text-left">
                  <th className="px-3 py-2 font-medium">Field</th>
                  <th className="px-3 py-2 font-medium">OCR Value</th>
                  <th className="px-3 py-2 font-medium">Barcode Value</th>
                  <th className="px-3 py-2 text-right font-medium">Match</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(kv).map(([rawKey, rawVal]) => {
                  const ocrKey = normalizeKey(rawKey);
                  const ocrValue = String(rawVal ?? "");
                  const barcodeValue = getBarcodeValueForOcrKey(ocrKey);
                  const match = getRowMatch(ocrValue, barcodeValue);

                  return (
                    <tr key={rawKey} className="border-b border-[var(--color-borderColor)] last:border-0">
                      <td className="px-3 py-2 font-medium">{rawKey}</td>
                      <td className="px-3 py-2">{ocrValue}</td>
                      <td className={`px-3 py-2 ${barcodeValue ? "" : "text-[var(--color-textSecondary)]"}`}>
                        {barcodeValue ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`flex items-center justify-end gap-2 text-sm ${match.className}`}>
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
              className={`text-xs ${
                validation.status === "mismatch"
                  ? "text-red-600"
                  : validation.status === "match"
                  ? "text-green-600"
                  : "text-[var(--color-textSecondary)]"
              }`}
            >
              {validation.message}
            </p>
          )}

          {barcodeWarnings.length > 0 && (
            <div className="text-xs">
              <p className="font-medium">Warnings</p>
              <ul className="list-disc list-inside text-[var(--color-textSecondary)]">
                {barcodeWarnings.map((w, i) => (
                  <li key={`${w}-${i}`}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {kv && (
        <Card header={<span className="font-medium">Live Buffer</span>} className="mt-4">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-borderColor)] text-left">
                  <th className="px-3 py-2 font-medium">Field</th>
                  <th className="px-3 py-2 font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {LIVE_BUFFER_FIELDS.map(({ label, keys }) => {
                  const v = getBufferValue(keys);
                  const has = Boolean(v && v.trim());
                  return (
                    <tr key={label} className="border-b border-[var(--color-borderColor)] last:border-0">
                      <td className="px-3 py-2 font-medium">{label}</td>
                      <td className={`px-3 py-2 ${has ? "" : "text-[var(--color-textSecondary)]"}`}>{has ? v : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {order && (
        <Card header={<span className="font-medium">Order Information</span>} className="mt-4">
          <p className="text-sm">Code: {order.code}</p>
          <p className="text-sm">Floor: {order.floor}</p>
          <p className="text-sm">Section: {order.section}</p>
          <p className="text-sm">Collected: {order.collected ? "Yes" : "No"}</p>
          <div className="mt-4 flex gap-2">
            {!order.collected && <Button onClick={markCollected}>Mark as Collected</Button>}
            <Button onClick={retrieveMap}>Retrieve Map</Button>
          </div>
        </Card>
      )}

      {kv && !order && (
        <Card header={<span className="font-medium">Create Order</span>} className="mt-4">
          <div className="space-y-3">
            <div>
              <label className="block text-sm mb-1">Floor</label>
              <Input type="text" value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="e.g. floor1" />
            </div>
            <div>
              <label className="block text-sm mb-1">Section</label>
              <Input
                type="text"
                value={section}
                onChange={(e) => setSection(e.target.value)}
                placeholder="e.g. section-a"
              />
            </div>
            <Button className="hover:cursor-pointer" onClick={createNewOrder} disabled={creating || validation?.status === "mismatch"}>
              {creating ? "Creating…" : "Create Order"}
            </Button>
          </div>
        </Card>
      )}

      {mapUrl && (
        <div className="mt-6">
          <h3 className="text-lg font-medium mb-2">Retrieved Map</h3>
          <img src={mapUrl} alt="Map image" className="max-w-full border border-[var(--color-borderColor)] rounded-md" />
        </div>
      )}
    </main>
  );
}
