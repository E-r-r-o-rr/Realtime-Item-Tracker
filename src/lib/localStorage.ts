"use client";

/**
 * Shared localStorage utilities for persisting the scanner dashboard state.
 * The UI relies on three buckets of data:
 *  - Live buffer: the most recent scan result.
 *  - History: an ordered log of previously saved scans.
 *  - Storage: editable staging rows used by the warehouse view.
 */

export const LS_KEYS = {
  LIVE: "os_live_buffer",
  HISTORY: "os_history",
} as const;

export interface LiveRecord {
  destination: string;
  itemName: string;
  trackingId: string;
  truckNumber: string;
  shipDate: string;
  expectedDepartureTime: string;
  origin: string;
}

export interface HistoryRecord extends LiveRecord {
  savedAt: string;
}

const isBrowser = () => typeof window !== "undefined";

const safeParse = <T,>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch (e) {
    console.warn("Failed to parse localStorage payload", e);
    return fallback;
  }
};

export const loadLiveRecord = (): LiveRecord | null => {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(LS_KEYS.LIVE);
  return safeParse<LiveRecord | null>(raw, null);
};

export const persistLiveRecord = (record: LiveRecord | null) => {
  if (!isBrowser()) return;
  if (record) {
    window.localStorage.setItem(LS_KEYS.LIVE, JSON.stringify(record));
  } else {
    window.localStorage.removeItem(LS_KEYS.LIVE);
  }
};

export const clearLiveRecord = () => persistLiveRecord(null);

export const loadHistoryRecords = (): HistoryRecord[] => {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(LS_KEYS.HISTORY);
  return safeParse<HistoryRecord[]>(raw, []);
};

export const persistHistoryRecords = (records: HistoryRecord[]) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(LS_KEYS.HISTORY, JSON.stringify(records));
};

export const pushHistoryRecord = (record: LiveRecord): HistoryRecord[] => {
  const entry: HistoryRecord = { ...record, savedAt: new Date().toISOString() };
  const current = loadHistoryRecords();
  const updated = [entry, ...current];
  persistHistoryRecords(updated);
  return updated;
};

export const clearHistoryRecords = () => {
  if (!isBrowser()) return;
  window.localStorage.removeItem(LS_KEYS.HISTORY);
};

