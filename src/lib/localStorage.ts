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
  STORAGE: "os_storage",
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

export interface StorageRecord extends LiveRecord {
  booked: boolean;
  lastUpdated: string;
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

export const loadStorageRecords = (): StorageRecord[] => {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(LS_KEYS.STORAGE);
  return safeParse<StorageRecord[]>(raw, []);
};

export const persistStorageRecords = (records: StorageRecord[]) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(LS_KEYS.STORAGE, JSON.stringify(records));
};

export const seedStorageRecords = (count = 15): StorageRecord[] => {
  const racks = [
    "R1-A",
    "R2-B",
    "R3-C",
    "R4-A",
    "R5-D",
    "R6-F",
    "R2-A",
    "R1-C",
    "R7-B",
    "R8-A",
    "R9-D",
    "R10-C",
    "R11-A",
    "R12-B",
    "R13-C",
  ];
  const products = [
    "Widget Alpha",
    "Widget Beta",
    "Gizmo Max",
    "Gizmo Mini",
    "Box Small",
    "Box Large",
    "Crate A",
    "Crate B",
    "Bag Red",
    "Bag Blue",
  ];
  const origins = ["Dock 1", "Dock 2", "Dock 3", "Inbound A", "Inbound B"];

  const items: StorageRecord[] = [];
  for (let i = 0; i < count; i++) {
    items.push({
      destination: racks[i % racks.length],
      itemName: products[i % products.length],
      trackingId: `TRK${String(100000 + i)}`,
      truckNumber: String(200 + (i % 7)),
      shipDate: `2025-09-${String(10 + (i % 15)).padStart(2, "0")}`,
      expectedDepartureTime: `${String(8 + (i % 9)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}`,
      origin: origins[i % origins.length],
      booked: i < 10,
      lastUpdated: new Date().toISOString(),
    });
  }
  persistStorageRecords(items);
  return items;
};

export const clearStorageRecords = () => {
  if (!isBrowser()) return;
  window.localStorage.removeItem(LS_KEYS.STORAGE);
};

export const writeRecordToStorage = (record: LiveRecord): StorageRecord[] => {
  const current = loadStorageRecords();
  const idx = current.findIndex((item) => item.trackingId === record.trackingId);
  const payload: StorageRecord = {
    ...record,
    booked: false,
    lastUpdated: new Date().toISOString(),
  };
  if (idx >= 0) {
    current[idx] = { ...current[idx], ...payload };
  } else {
    current.unshift(payload);
  }
  persistStorageRecords(current);
  return current;
};

