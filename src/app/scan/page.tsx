"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CurrentScanPanel } from '@/components/current-scan-panel';
import type { CurrentScanRecord, OrderFields } from '@/types/warehouse';
import { ORDER_FIELD_KEYS, ORDER_FIELD_LABELS } from '@/types/warehouse';

const API_KEY = process.env.NEXT_PUBLIC_API_KEY;

interface BookingOption {
  trackingId: string;
  itemName: string;
}

export default function ScanPage() {
  const [file, setFile] = useState<File | null>(null);
  const [bookings, setBookings] = useState<BookingOption[]>([]);
  const [selectedSample, setSelectedSample] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentScan, setCurrentScan] = useState<CurrentScanRecord | null>(null);
  const [normalized, setNormalized] = useState<OrderFields | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOptions = useMemo(() => {
    const headers: HeadersInit = { 'x-api-key': API_KEY ?? '' };
    return API_KEY ? { headers } : {};
  }, []);

  const loadBookings = useCallback(async () => {
    try {
      const response = await fetch('/api/bookings', fetchOptions);
      if (!response.ok) throw new Error('Failed to load bookings');
      const data = await response.json();
      setBookings(
        (data.bookings ?? []).map((order: OrderFields) => ({
          trackingId: order.trackingId,
          itemName: order.itemName,
        })),
      );
    } catch (err: any) {
      console.error(err);
      setError('Unable to load booking samples.');
    }
  }, [fetchOptions]);

  const loadCurrentScan = useCallback(async () => {
    try {
      const response = await fetch('/api/current-scan', fetchOptions);
      if (!response.ok) throw new Error('Failed to load current scan');
      const data = await response.json();
      setCurrentScan(data.currentScan ?? null);
    } catch (err: any) {
      console.error(err);
    }
  }, [fetchOptions]);

  const triggerRefresh = useCallback(async () => {
    try {
      setRefreshing(true);
      const response = await fetch('/api/jobs/refresh-current-scan', {
        method: 'POST',
        ...(API_KEY ? { headers: { 'x-api-key': API_KEY } } : {}),
      });
      if (!response.ok) throw new Error('Refresh failed');
      const data = await response.json();
      setCurrentScan(data.currentScan ?? null);
    } catch (err: any) {
      console.error(err);
      setError('Unable to refresh current scan.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadBookings();
    loadCurrentScan();
    const interval = setInterval(() => {
      triggerRefresh();
    }, 300_000);
    return () => clearInterval(interval);
  }, [loadBookings, loadCurrentScan, triggerRefresh]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      setFile(null);
      return;
    }
    setFile(files[0]);
  };

  const submitScan = useCallback(
    async (payload: FormData | Record<string, any>, isMultipart: boolean) => {
      setLoading(true);
      setStatus('Processing scan…');
      setError(null);
      try {
        const response = await fetch('/api/scan', {
          method: 'POST',
          body: isMultipart ? (payload as FormData) : JSON.stringify(payload),
          headers: isMultipart
            ? API_KEY
              ? { 'x-api-key': API_KEY }
              : undefined
            : {
                'Content-Type': 'application/json',
                ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
              },
        });
        if (!response.ok) {
          throw new Error((await response.json()).error || 'Scan failed.');
        }
        const data = await response.json();
        setCurrentScan(data.currentScan ?? null);
        setNormalized(data.normalized ?? null);
        setStatus('Scan completed and validation triggered.');
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Scan failed.');
        setStatus(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const handleUpload = async () => {
    if (!file) {
      setError('Select a file to scan.');
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    await submitScan(formData, true);
  };

  const handleSampleScan = async () => {
    if (!selectedSample) {
      setError('Select a booking sample first.');
      return;
    }
    await submitScan({ sampleTrackingId: selectedSample }, false);
  };

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Scan Order Ticket</h1>
        <p className="text-sm text-[var(--color-foreground)]/80">
          Upload a photo or PDF to route it through OCR, or simulate a scan using a seeded booking. Each scan updates the
          archive and the current validation buffer automatically.
        </p>
      </header>

      {status && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 text-sm text-green-700">
          {status}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <Card header={<span className="font-semibold">Upload Ticket</span>}>
          <div className="space-y-4 text-sm">
            <Input type="file" accept="image/*,.pdf" onChange={handleFileChange} />
            <Button type="button" className="hover:cursor-pointer" onClick={handleUpload} disabled={loading}>
              {loading ? 'Scanning…' : 'Scan Uploaded File'}
            </Button>
            <p className="text-xs text-[var(--color-foreground)]/70">
              The Python OCR pipeline runs when available; otherwise a stub extracts values so you can test the full flow.
            </p>
          </div>
        </Card>

        <Card header={<span className="font-semibold">Simulate with Booking Sample</span>}>
          <div className="space-y-4 text-sm">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Booking sample</span>
              <select
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2"
                value={selectedSample}
                onChange={(event) => setSelectedSample(event.target.value)}
              >
                <option value="">Select a booking…</option>
                {bookings.map((booking) => (
                  <option key={booking.trackingId} value={booking.trackingId}>
                    {booking.itemName} — {booking.trackingId}
                  </option>
                ))}
              </select>
            </label>
            <Button type="button" className="hover:cursor-pointer" onClick={handleSampleScan} disabled={loading}>
              {loading ? 'Scanning…' : 'Simulate Scan'}
            </Button>
          </div>
        </Card>
      </section>

      {normalized && (
        <Card header={<span className="font-semibold">Normalized Fields Written to Tables</span>}>
          <div className="overflow-x-auto text-sm">
            <table className="min-w-full table-auto">
              <thead>
                <tr className="bg-[var(--color-card)]">
                  {ORDER_FIELD_KEYS.map((key) => (
                    <th key={key} className="px-3 py-2 text-left font-semibold">
                      {ORDER_FIELD_LABELS[key]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-[var(--color-border)]">
                  {ORDER_FIELD_KEYS.map((key) => (
                    <td key={key} className="px-3 py-2 align-top">
                      {normalized[key]}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <CurrentScanPanel currentScan={currentScan} onRefresh={triggerRefresh} refreshing={refreshing} />
    </div>
  );
}
