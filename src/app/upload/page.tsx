"use client";

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

interface KvPairs {
  [key: string]: string;
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
  status: 'match' | 'mismatch' | 'no_barcode' | 'missing_item_code';
  message: string;
  comparedValue?: string;
}

const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

const LIVE_BUFFER_FIELDS: Array<{ label: string; keys: string[] }> = [
  { label: 'Destination', keys: ['destination'] },
  { label: 'Item Name', keys: ['item_name', 'itemname', 'product_name', 'productname'] },
  {
    label: 'Tracking ID (Order ID)',
    keys: ['tracking_id', 'trackingid', 'order_id', 'orderid'],
  },
  { label: 'Truck Number', keys: ['truck_number', 'trucknumber', 'truck_no', 'truck'] },
  { label: 'Ship Date', keys: ['ship_date', 'shipdate', 'shipping_date'] },
  {
    label: 'Expected Departure Time',
    keys: ['expected_departure_time', 'expecteddeparturetime', 'departure_time'],
  },
  {
    label: 'Origin (Origin Warehouse)',
    keys: ['origin', 'origin_warehouse', 'originwarehouse'],
  },
];

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [kv, setKv] = useState<KvPairs | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [floor, setFloor] = useState('');
  const [section, setSection] = useState('');
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [barcodes, setBarcodes] = useState<string[]>([]);
  const [barcodeWarnings, setBarcodeWarnings] = useState<string[]>([]);
  const [validation, setValidation] = useState<BarcodeValidation | null>(null);

  const API_KEY = process.env.NEXT_PUBLIC_API_KEY || 'my-secret-api-key';

  const normalizedKv = useMemo(() => {
    const map = new Map<string, string>();
    if (!kv) {
      return map;
    }
    Object.entries(kv).forEach(([key, value]) => {
      map.set(normalizeKey(key), value ?? '');
    });
    return map;
  }, [kv]);

  const getBufferedValue = (keys: string[]) => {
    for (const candidate of keys) {
      const normalized = normalizeKey(candidate);
      const value = normalizedKv.get(normalized);
      if (value && value.trim()) {
        return value;
      }
    }
    return '';
  };

  const getMatchState = (isItemCodeRow: boolean) => {
    if (!isItemCodeRow) {
      return {
        symbol: '–',
        label: 'Not compared',
        className: 'text-[var(--color-textSecondary)]',
      };
    }
    if (!validation) {
      if (!barcodes.length) {
        return {
          symbol: '–',
          label: 'No barcode detected',
          className: 'text-[var(--color-textSecondary)]',
        };
      }
      return {
        symbol: '–',
        label: 'Pending',
        className: 'text-[var(--color-textSecondary)]',
      };
    }
    switch (validation.status) {
      case 'match':
        return { symbol: '✓', label: 'Match', className: 'text-green-600' };
      case 'mismatch':
        return { symbol: '✗', label: 'Mismatch', className: 'text-red-600' };
      case 'no_barcode':
        return {
          symbol: '–',
          label: 'No barcode detected',
          className: 'text-[var(--color-textSecondary)]',
        };
      case 'missing_item_code':
        return { symbol: '✗', label: 'Missing item code', className: 'text-red-600' };
      default:
        return {
          symbol: '–',
          label: 'Not compared',
          className: 'text-[var(--color-textSecondary)]',
        };
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files[0]) {
      setFile(files[0]);
      // Reset previous state
      setKv(null);
      setOrder(null);
      setMapUrl(null);
      setStatus(null);
      setBarcodes([]);
      setBarcodeWarnings([]);
      setValidation(null);
    }
  };

  const scanDocument = async () => {
    if (!file) return;
    setLoading(true);
    setStatus('Uploading file and scanning…');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'x-api-key': API_KEY },
        body: formData,
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await res.json();
      const extracted: KvPairs = data.kv || {};
      const validationStatus: BarcodeValidation['status'] | undefined = data.validation?.status;
      const sanitizedBarcodes = Array.isArray(data.barcodes)
        ? data.barcodes
            .map((code: unknown) => String(code ?? '').trim())
            .filter((code: string) => code.length > 0)
        : [];
      setBarcodes(sanitizedBarcodes);
      const sanitizedWarnings = Array.isArray(data.barcodeWarnings)
        ? data.barcodeWarnings
            .map((warning: unknown) => String(warning ?? '').trim())
            .filter((warning: string) => warning.length > 0)
        : [];
      setBarcodeWarnings(sanitizedWarnings);
      setValidation(data.validation ?? null);
      setKv(extracted);
      const code = extracted.item_code;
      if (validationStatus === 'mismatch') {
        setStatus(data.validation.message);
      } else if (validationStatus === 'match') {
        setStatus('Barcode and OCR values align. Checking database…');
      } else if (validationStatus === 'no_barcode') {
        setStatus('No barcode detected; continuing with OCR results.');
      } else if (validationStatus === 'missing_item_code') {
        setStatus('Barcode detected but OCR did not yield an item code.');
      }
      if (code) {
        if (!validationStatus || validationStatus === 'match') {
          setStatus(`Extracted item code ${code}. Checking database…`);
        }
        const resOrder = await fetch(`/api/orders?code=${encodeURIComponent(code)}`, {
          headers: { 'x-api-key': API_KEY },
        });
        if (resOrder.ok) {
          const json = await resOrder.json();
          if (json.order) {
            setOrder(json.order as Order);
            setFloor(json.order.floor);
            setSection(json.order.section);
            if (validationStatus === 'mismatch') {
              setStatus(data.validation.message);
            } else {
              setStatus(`Order ${code} found.`);
            }
          } else {
            if (validationStatus === 'mismatch') {
              setStatus(data.validation.message);
            } else {
              setStatus(`Order ${code} not found. You can add it below.`);
            }
            setOrder(null);
            setFloor('');
            setSection('');
          }
        } else if (resOrder.status === 404) {
          if (validationStatus === 'mismatch') {
            setStatus(data.validation.message);
          } else {
            setStatus(`Order ${code} not found. You can add it below.`);
          }
          setOrder(null);
        } else {
          setStatus('Failed to check order.');
        }
      } else {
        setStatus('No item code extracted.');
      }
    } catch (err: any) {
      console.error(err);
      setStatus('Error scanning document.');
    } finally {
      setLoading(false);
    }
  };

  const createNewOrder = async () => {
    if (!kv) return;
    const code = kv.item_code;
    if (!code || !floor || !section) {
      setStatus('Please enter floor and section.');
      return;
    }
    if (validation?.status === 'mismatch') {
      setStatus('Resolve the barcode mismatch before creating a new order.');
      return;
    }
    setCreating(true);
    setStatus('Creating order…');
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
        },
        body: JSON.stringify({ code, data: kv, floor, section }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg);
      }
      const json = await res.json();
      setOrder(json.order as Order);
      setStatus(`Order ${code} created.`);
    } catch (err: any) {
      console.error(err);
      setStatus('Failed to create order.');
    } finally {
      setCreating(false);
    }
  };

  const markCollected = async () => {
    if (!order) return;
    setStatus('Marking as collected…');
    try {
      const res = await fetch('/api/orders', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
        },
        body: JSON.stringify({ code: order.code, collected: true }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const json = await res.json();
      setOrder(json.order as Order);
      setStatus(`Order ${order.code} marked as collected.`);
    } catch (err: any) {
      console.error(err);
      setStatus('Failed to mark order.');
    }
  };

  const retrieveMap = async () => {
    if (!order && !kv) return;
    const code = order ? order.code : kv?.item_code;
    if (!code) {
      setStatus('No item code found.');
      return;
    }
    setStatus('Resolving map…');
    try {
      const res = await fetch(`/api/items/${code}/map`, {
        headers: { 'x-api-key': API_KEY },
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = await res.json();
      const mapRes = await fetch(`/api/maps?key=${data.mapKey}`, {
        headers: { 'x-api-key': API_KEY },
      });
      if (!mapRes.ok) {
        throw new Error(await mapRes.text());
      }
      const blob = await mapRes.blob();
      const url = URL.createObjectURL(blob);
      setMapUrl(url);
      setStatus(`Map for ${code} loaded.`);
    } catch (err: any) {
      console.error(err);
      setStatus('Failed to retrieve map.');
    }
  };

  return (
    <main className="mx-auto max-w-3xl py-10 px-4 space-y-6">
      <h2 className="text-2xl font-semibold">Scan Order Document</h2>
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Upload PDF or Image</span>
          <Input
            type="file"
            accept="image/*,application/pdf"
            onChange={handleFileChange}
          />
        </label>
        <Button className='hover:cursor-pointer' onClick={scanDocument} disabled={!file || loading}>
          {loading ? 'Scanning…' : 'Scan Document'}
        </Button>
      </div>
      {status && <p className="text-sm text-[var(--color-textSecondary)]">{status}</p>}
      {kv && (
        <Card
          header={<span className="font-medium">Extracted OCR &amp; Barcode Data</span>}
          className="mt-4 space-y-3"
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-borderColor)] text-left">
                  <th className="px-3 py-2 font-medium">Field</th>
                  <th className="px-3 py-2 font-medium">OCR Value</th>
                  <th className="px-3 py-2 font-medium">Barcode Value(s)</th>
                  <th className="px-3 py-2 text-right font-medium">Match</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(kv).map(([key, value]) => {
                  const normalizedKey = normalizeKey(key);
                  const isItemCodeRow = normalizedKey === 'itemcode';
                  const matchState = getMatchState(isItemCodeRow);
                  const rawBarcodeValues = isItemCodeRow
                    ? validation?.comparedValue ?? barcodes.join(', ')
                    : '';
                  const barcodeDisplay = rawBarcodeValues.trim();
                  const hasBarcodeValue = Boolean(barcodeDisplay);

                  return (
                    <tr
                      key={key}
                      className="border-b border-[var(--color-borderColor)] last:border-0"
                    >
                      <td className="px-3 py-2 font-medium">{key}</td>
                      <td className="px-3 py-2">{value}</td>
                      <td className={`px-3 py-2 ${hasBarcodeValue ? '' : 'text-[var(--color-textSecondary)]'}`}>
                        {hasBarcodeValue ? barcodeDisplay : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`flex items-center justify-end gap-2 text-sm ${matchState.className}`}
                        >
                          <span aria-hidden>{matchState.symbol}</span>
                          <span className="text-xs uppercase tracking-wide">{matchState.label}</span>
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
                validation.status === 'mismatch'
                  ? 'text-red-600'
                  : validation.status === 'match'
                    ? 'text-green-600'
                    : 'text-[var(--color-textSecondary)]'
              }`}
            >
              {validation.message}
            </p>
          )}
          {barcodeWarnings.length > 0 && (
            <div className="text-xs">
              <p className="font-medium">Warnings</p>
              <ul className="list-disc list-inside text-[var(--color-textSecondary)]">
                {barcodeWarnings.map((warning, idx) => (
                  <li key={`${warning}-${idx}`}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
      {kv && (
        <Card
          header={<span className="font-medium">Live Buffer</span>}
          className="mt-4"
        >
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
                  const value = getBufferedValue(keys);
                  const hasValue = Boolean(value && value.trim());
                  return (
                    <tr
                      key={label}
                      className="border-b border-[var(--color-borderColor)] last:border-0"
                    >
                      <td className="px-3 py-2 font-medium">{label}</td>
                      <td
                        className={`px-3 py-2 ${hasValue ? '' : 'text-[var(--color-textSecondary)]'}`}
                      >
                        {hasValue ? value : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {/* Order exists */}
      {order && (
        <Card
          header={<span className="font-medium">Order Information</span>}
          className="mt-4"
        >
          <p className="text-sm">Code: {order.code}</p>
          <p className="text-sm">Floor: {order.floor}</p>
          <p className="text-sm">Section: {order.section}</p>
          <p className="text-sm">Collected: {order.collected ? 'Yes' : 'No'}</p>
          <div className="mt-4 flex space-x-2">
            {!order.collected && (
              <Button onClick={markCollected}>Mark as Collected</Button>
            )}
            <Button onClick={retrieveMap}>Retrieve Map</Button>
          </div>
        </Card>
      )}
      {/* No order found: allow creation */}
      {kv && !order && (
        <Card header={<span className="font-medium">Create Order</span>} className="mt-4">
          <div className="space-y-3">
            <div>
              <label className="block text-sm mb-1">Floor</label>
              <Input
                type="text"
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                placeholder="e.g. floor1"
              />
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
            <Button
              className='hover:cursor-pointer'
              onClick={createNewOrder}
              disabled={creating || validation?.status === 'mismatch'}
            >
              {creating ? 'Creating…' : 'Create Order'}
            </Button>
          </div>
        </Card>
      )}
      {/* Display map if loaded */}
      {mapUrl && (
        <div className="mt-6">
          <h3 className="text-lg font-medium mb-2">Retrieved Map</h3>
          <img src={mapUrl} alt="Map image" className="max-w-full border border-[var(--color-borderColor)] rounded-md" />
        </div>
      )}
    </main>
  );
}