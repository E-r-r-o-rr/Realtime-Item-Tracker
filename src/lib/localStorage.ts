"use client";

export const LS_KEYS = {
  LIVE: "os_live_buffer",
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

