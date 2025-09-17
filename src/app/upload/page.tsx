"use client";

import { useState } from 'react';
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

  const API_KEY = process.env.NEXT_PUBLIC_API_KEY || 'my-secret-api-key';

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files[0]) {
      setFile(files[0]);
      // Reset previous state
      setKv(null);
      setOrder(null);
      setMapUrl(null);
      setStatus(null);
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
      setKv(extracted);
      const code = extracted.item_code;
      if (code) {
        setStatus(`Extracted item code ${code}. Checking database…`);
        const resOrder = await fetch(`/api/orders?code=${encodeURIComponent(code)}`, {
          headers: { 'x-api-key': API_KEY },
        });
        if (resOrder.ok) {
          const json = await resOrder.json();
          if (json.order) {
            setOrder(json.order as Order);
            setFloor(json.order.floor);
            setSection(json.order.section);
            setStatus(`Order ${code} found.`);
          } else {
            setStatus(`Order ${code} not found. You can add it below.`);
            setOrder(null);
            setFloor('');
            setSection('');
          }
        } else if (resOrder.status === 404) {
          setStatus(`Order ${code} not found. You can add it below.`);
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
          header={<span className="font-medium">Extracted key/value pairs</span>}
          className="mt-4"
        >
          <ul className="space-y-1 text-sm">
            {Object.entries(kv).map(([k, v]) => (
              <li key={k} className="flex justify-between"><span className="font-medium">{k}</span><span>{v}</span></li>
            ))}
          </ul>
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
            <Button className='hover:cursor-pointer' onClick={createNewOrder} disabled={creating}>
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