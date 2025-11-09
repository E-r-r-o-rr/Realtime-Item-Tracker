import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

type MockStorage = {
  store: Map<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

const createMockLocalStorage = (): MockStorage => {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
};

let originalWindow: any;

beforeEach(() => {
  originalWindow = (globalThis as any).window;
});

afterEach(() => {
  mock.restoreAll();
  if (originalWindow === undefined) {
    delete (globalThis as any).window;
  } else {
    globalThis.window = originalWindow;
  }
});

describe("localStorage helpers", () => {
  it("returns null when executed outside the browser", async () => {
    delete (globalThis as any).window;
    const { loadLiveRecord } = await import(`@/lib/localStorage?server-${Date.now()}`);
    assert.equal(loadLiveRecord(), null);
  });

  it("persists and clears live records", async () => {
    (globalThis as any).window = { localStorage: createMockLocalStorage() };

    const modulePath = `@/lib/localStorage?client-${Date.now()}`;
    const { loadLiveRecord, persistLiveRecord, clearLiveRecord, LS_KEYS } = await import(modulePath);

    const record = {
      destination: "R1-A",
      itemName: "Widget",
      trackingId: "ABC123",
      truckNumber: "T-5",
      shipDate: "2025-03-01",
      expectedDepartureTime: "10:30",
      origin: "Dock 4",
    };

    persistLiveRecord(record);
    const storage = window.localStorage as unknown as MockStorage;
    assert.equal(storage.store.size, 1);
    const loaded = loadLiveRecord();
    assert.deepEqual(loaded, record);

    clearLiveRecord();
    assert.equal(storage.store.has(LS_KEYS.LIVE), false);
  });

  it("swallows JSON parse errors and returns fallback", async () => {
    (globalThis as any).window = { localStorage: createMockLocalStorage() };

    const modulePath = `@/lib/localStorage?bad-${Date.now()}`;
    const { loadLiveRecord, LS_KEYS } = await import(modulePath);

    const warn = mock.method(console, "warn", mock.fn());
    (window.localStorage as unknown as MockStorage).setItem(LS_KEYS.LIVE, "not-json");
    const result = loadLiveRecord();
    assert.equal(result, null);
    assert.equal(warn.mock.callCount(), 1);
  });
});
