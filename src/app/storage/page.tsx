"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { StorageRecord } from '@/types/warehouse';
import { ORDER_FIELD_KEYS, ORDER_FIELD_LABELS } from '@/types/warehouse';

const EDITABLE_FIELDS: (keyof StorageRecord)[] = ['destination', 'trackingId', 'expectedDeparture'];
const API_KEY = process.env.NEXT_PUBLIC_API_KEY;

type EditableField = (typeof EDITABLE_FIELDS)[number];

export default function StoragePage() {
  const [rows, setRows] = useState<StorageRecord[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const fetchOptions = useMemo(() => {
    const headers: HeadersInit = { 'x-api-key': API_KEY ?? '' };
    return API_KEY ? { headers } : {};
  }, []);

  const loadStorage = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/storage', fetchOptions);
      if (!response.ok) throw new Error('Failed to load storage rows');
      const data = await response.json();
      setRows(data.storage ?? []);
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError('Unable to load storage table.');
    } finally {
      setLoading(false);
    }
  }, [fetchOptions]);

  useEffect(() => {
    loadStorage();
  }, [loadStorage]);

  const updateField = async (id: string, field: EditableField, value: string) => {
    const previous = rows.find((row) => row.id === id);
    setRows((existing) => existing.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setPendingId(id);
    setStatus(`Updating ${field} for ${id}…`);
    setError(null);
    try {
      const response = await fetch(`/api/storage/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
        },
        body: JSON.stringify({ [field]: value }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Update failed');
      }
      const data = await response.json();
      setRows((existing) => existing.map((row) => (row.id === id ? data.storage : row)));
      setStatus(`Storage row ${id} saved.`);
    } catch (err: any) {
      console.error(err);
      setStatus(null);
      setError(err.message || 'Failed to update storage row.');
      if (previous) {
        setRows((existing) => existing.map((row) => (row.id === id ? { ...row, [field]: previous[field] } : row)));
      }
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Storage Table</h1>
        <p className="text-sm text-[var(--color-foreground)]/80">
          Fifteen rows are seeded, including all ten bookings. Destination, Tracking ID, and Expected Departure Time can be
          edited in place to simulate live updates.
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

      <Card header={<span className="font-semibold">Live Storage Assignments</span>}>
        <div className="overflow-x-auto text-sm">
          <table className="min-w-full table-auto">
            <thead>
              <tr className="bg-[var(--color-card)]">
                <th className="px-3 py-2 text-left font-semibold">Storage ID</th>
                {ORDER_FIELD_KEYS.map((key) => (
                  <th key={key} className="px-3 py-2 text-left font-semibold">
                    {ORDER_FIELD_LABELS[key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={ORDER_FIELD_KEYS.length + 1} className="px-3 py-4 text-center text-[var(--color-foreground)]/70">
                    Loading storage rows…
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-t border-[var(--color-border)]">
                    <td className="px-3 py-2 align-top font-medium">{row.id}</td>
                    {ORDER_FIELD_KEYS.map((key) => (
                      <td key={key} className="px-3 py-2 align-top">
                        {EDITABLE_FIELDS.includes(key as EditableField) ? (
                          <Input
                            type={key === 'expectedDeparture' ? 'time' : 'text'}
                            value={row[key]}
                            onChange={(event) => updateField(row.id, key as EditableField, event.target.value)}
                            disabled={pendingId === row.id}
                            className="min-w-[7rem]"
                          />
                        ) : (
                          row[key]
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-[var(--color-foreground)]/70">
          Linked scans automatically refresh every five minutes and whenever you update a matching storage row.
        </p>
      </Card>
    </div>
  );
}
