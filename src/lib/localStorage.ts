"use client";

export const LS_KEYS = {
  LIVE: "os_live_buffer",
  VLM_SETTINGS: "os_vlm_settings",
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

export type VlmMode = "local" | "remote";

export interface VlmRemoteSettings {
  endpointUrl: string;
  apiKey: string;
  model: string;
  requestTimeoutMs: number;
  maxRetries: number;
  enableStreaming: boolean;
}

export interface VlmSettings {
  mode: VlmMode;
  remote: VlmRemoteSettings;
}

export const DEFAULT_VLM_SETTINGS: VlmSettings = {
  mode: "remote",
  remote: {
    endpointUrl: "https://api.example.com/vlm",
    apiKey: "",
    model: "vlm-latest",
    requestTimeoutMs: 30000,
    maxRetries: 2,
    enableStreaming: true,
  },
};

export const loadVlmSettings = (): VlmSettings => {
  if (!isBrowser()) return DEFAULT_VLM_SETTINGS;
  const raw = window.localStorage.getItem(LS_KEYS.VLM_SETTINGS);
  return safeParse<VlmSettings>(raw, DEFAULT_VLM_SETTINGS);
};

export const persistVlmSettings = (settings: VlmSettings) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(LS_KEYS.VLM_SETTINGS, JSON.stringify(settings));
};

export const resetVlmSettings = () => persistVlmSettings(DEFAULT_VLM_SETTINGS);

