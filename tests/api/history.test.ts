import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { useTestDatabase } from "../helpers/db";

const importHistoryRoute = async () =>
  import(`../../src/app/api/history/route.ts?test=${Date.now()}-${Math.random()}`) as Promise<
    typeof import("../../src/app/api/history/route")
  >;

const importHistoryIdRoute = async () =>
  import(`../../src/app/api/history/[id]/route.ts?test=${Date.now()}-${Math.random()}`) as Promise<
    typeof import("../../src/app/api/history/[id]/route")
  >;

type LogisticsPayload = {
  destination: string;
  itemName: string;
  trackingId: string;
  truckNumber: string;
  shipDate: string;
  expectedDepartureTime: string;
  originLocation: string;
};

const buildPayload = (overrides: Partial<LogisticsPayload> = {}): LogisticsPayload => ({
  destination: "R1-A",
  itemName: "Widget",
  trackingId: "TRACK-1",
  truckNumber: "TRUCK-9",
  shipDate: "2025-05-10",
  expectedDepartureTime: "08:30",
  originLocation: "Dock 1",
  ...overrides,
});

describe("history API routes", { concurrency: false }, () => {
  useTestDatabase();

  it("lists recorded history entries", async () => {
    const { ingestLiveBufferEntry, clearHistory, listHistory } = await import("../../src/lib/db");
    clearHistory();
    ingestLiveBufferEntry(buildPayload());

    const { GET } = await importHistoryRoute();
    const response = await GET();
    assert.equal(response.status, 200);
    const data = (await response.json()) as { history: Array<{ trackingId: string }> };
    assert.equal(data.history.length, 1);
    assert.equal(data.history[0]?.trackingId, "TRACK-1");

    const all = listHistory();
    assert.equal(all.length, 1);
  });

  it("clears history entries", async () => {
    const { ingestLiveBufferEntry, clearHistory } = await import("../../src/lib/db");
    clearHistory();
    ingestLiveBufferEntry(buildPayload());
    ingestLiveBufferEntry(buildPayload({ trackingId: "TRACK-2" }));

    const { DELETE } = await importHistoryRoute();
    const response = await DELETE();
    assert.equal(response.status, 200);
    const data = (await response.json()) as { cleared: number };
    assert.equal(data.cleared, 2);

    const { listHistory } = await import("../../src/lib/db");
    assert.equal(listHistory().length, 0);
  });

  it("validates and deletes individual entries", async () => {
    const { ingestLiveBufferEntry, listHistory } = await import("../../src/lib/db");
    ingestLiveBufferEntry(buildPayload({ trackingId: "TRACK-99" }));
    const history = listHistory();
    const targetId = history[0]!.id;

    const { DELETE } = await importHistoryIdRoute();

    const badIdResponse = await DELETE(new Request("https://example.test/api/history/abc"), {
      params: Promise.resolve({ id: "abc" }),
    });
    assert.equal(badIdResponse.status, 400);

    const okResponse = await DELETE(new Request("https://example.test/api/history/1"), {
      params: Promise.resolve({ id: String(targetId) }),
    });
    assert.equal(okResponse.status, 200);
    const okData = (await okResponse.json()) as { success: boolean };
    assert.equal(okData.success, true);

    const missingResponse = await DELETE(new Request("https://example.test/api/history/1"), {
      params: Promise.resolve({ id: String(targetId) }),
    });
    assert.equal(missingResponse.status, 404);
    const missingData = (await missingResponse.json()) as { error: string };
    assert.equal(missingData.error, "History entry not found");
  });
});
