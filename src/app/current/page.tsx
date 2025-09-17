"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CurrentScanPanel } from '@/components/current-scan-panel';
import type { CurrentScanRecord } from '@/types/warehouse';

const API_KEY = process.env.NEXT_PUBLIC_API_KEY;

export default function CurrentScanPage() {
  const [currentScan, setCurrentScan] = useState<CurrentScanRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastPolled, setLastPolled] = useState<string | null>(null);

  const fetchOptions = useMemo(() => {
    const headers: HeadersInit = { 'x-api-key': API_KEY ?? '' };
    return API_KEY ? { headers } : {};
  }, []);

  const loadCurrentScan = useCallback(async () => {
    try {
      const response = await fetch('/api/current-scan', fetchOptions);
      if (!response.ok) throw new Error('Failed to load current scan');
      const data = await response.json();
      setCurrentScan(data.currentScan ?? null);
      setLastPolled(new Date().toISOString());
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError('Unable to load the current scan buffer.');
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
      setLastPolled(new Date().toISOString());
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError('Unable to refresh from storage.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadCurrentScan();
    const interval = setInterval(() => {
      triggerRefresh();
    }, 300_000);
    return () => clearInterval(interval);
  }, [loadCurrentScan, triggerRefresh]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Current Scan Buffer</h1>
        <p className="text-sm text-[var(--color-foreground)]/80">
          This single-row buffer mirrors the most recent scan. A background job refreshes it every five minutes by pulling
          the latest values from storage for the matched truck and ship date.
        </p>
        {lastPolled && (
          <p className="text-xs text-[var(--color-foreground)]/70">Last checked {formatTimestamp(lastPolled)}.</p>
        )}
      </header>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      <CurrentScanPanel currentScan={currentScan} onRefresh={triggerRefresh} refreshing={refreshing} />
    </div>
  );
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
