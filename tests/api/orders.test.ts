import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { useTestDatabase } from "../helpers/db";

const importOrdersRoute = async () =>
  import(`../../src/app/api/orders/route.ts?test=${Date.now()}-${Math.random()}`) as Promise<
    typeof import("../../src/app/api/orders/route")
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
  trackingId: "TRACK-100",
  truckNumber: "TRUCK-1",
  shipDate: "2025-05-10",
  expectedDepartureTime: "08:30",
  originLocation: "Dock 1",
  ...overrides,
});

describe("orders API routes", { concurrency: false }, () => {
  useTestDatabase();

  it("ingests orders into the live buffer and history", async () => {
    const { POST, GET } = await importOrdersRoute();
    const request = new Request("https://example.test/api/orders", {
      method: "POST",
      body: JSON.stringify(buildPayload()),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    assert.equal(response.status, 201);
    const data = (await response.json()) as {
      record: { trackingId: string };
      historyEntry: { trackingId: string };
    };
    assert.equal(data.record.trackingId, "TRACK-100");
    assert.equal(data.historyEntry.trackingId, "TRACK-100");

    const listResponse = await GET(new Request("https://example.test/api/orders", { method: "GET" }));
    const listData = (await listResponse.json()) as { liveBuffer: Array<{ trackingId: string }> };
    assert.equal(listData.liveBuffer.length, 1);
    assert.equal(listData.liveBuffer[0]?.trackingId, "TRACK-100");
  });

  it("validates incoming payloads", async () => {
    const { POST } = await importOrdersRoute();
    const request = new Request("https://example.test/api/orders", {
      method: "POST",
      body: JSON.stringify({ ...buildPayload(), destination: "" }),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request);
    assert.equal(response.status, 400);
    const data = (await response.json()) as { error: string };
    assert.equal(data.error, "Missing required field: destination");
  });

  it("returns individual records and handles 404s", async () => {
    const { POST, GET } = await importOrdersRoute();
    await POST(
      new Request("https://example.test/api/orders", {
        method: "POST",
        body: JSON.stringify(buildPayload({ trackingId: "TRACK-ABC" })),
        headers: { "content-type": "application/json" },
      }),
    );

    const okResponse = await GET(new Request("https://example.test/api/orders?trackingId=TRACK-ABC"));
    assert.equal(okResponse.status, 200);
    const okData = (await okResponse.json()) as { record: { trackingId: string } };
    assert.equal(okData.record.trackingId, "TRACK-ABC");

    const missingResponse = await GET(new Request("https://example.test/api/orders?trackingId=TRACK-404"));
    assert.equal(missingResponse.status, 404);
    const missingData = (await missingResponse.json()) as { error: string };
    assert.equal(missingData.error, "Live buffer entry not found");
  });

  it("re-verifies bookings when requested", async () => {
    const { POST, GET } = await importOrdersRoute();
    const { upsertStorageRecord } = await import("../../src/lib/db");
    upsertStorageRecord({ ...buildPayload(), booked: true });

    await POST(
      new Request("https://example.test/api/orders", {
        method: "POST",
        body: JSON.stringify(buildPayload()),
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await GET(
      new Request("https://example.test/api/orders?trackingId=TRACK-100&verifyBooking=true"),
    );
    assert.equal(response.status, 200);
    const data = (await response.json()) as { bookingFound: boolean; message?: string };
    assert.equal(data.bookingFound, true);
    assert.ok(data.message?.includes("Booked item"));
  });

  it("deletes specific live buffer entries", async () => {
    const { POST, DELETE, GET } = await importOrdersRoute();
    await POST(
      new Request("https://example.test/api/orders", {
        method: "POST",
        body: JSON.stringify(buildPayload()),
        headers: { "content-type": "application/json" },
      }),
    );

    const missing = await DELETE(new Request("https://example.test/api/orders?trackingId=UNKNOWN"));
    assert.equal(missing.status, 404);

    const cleared = await DELETE(new Request("https://example.test/api/orders?trackingId=TRACK-100"));
    assert.equal(cleared.status, 200);
    const clearedData = (await cleared.json()) as { liveBuffer: unknown[] };
    assert.equal(clearedData.liveBuffer.length, 0);

    const listResponse = await GET(new Request("https://example.test/api/orders"));
    const listData = (await listResponse.json()) as { liveBuffer: unknown[] };
    assert.equal(listData.liveBuffer.length, 0);
  });

  it("clears the live buffer when no tracking id is supplied", async () => {
    const { POST, DELETE } = await importOrdersRoute();
    await POST(
      new Request("https://example.test/api/orders", {
        method: "POST",
        body: JSON.stringify(buildPayload({ trackingId: "TRACK-A" })),
        headers: { "content-type": "application/json" },
      }),
    );
    await POST(
      new Request("https://example.test/api/orders", {
        method: "POST",
        body: JSON.stringify(buildPayload({ trackingId: "TRACK-B" })),
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await DELETE(new Request("https://example.test/api/orders", { method: "DELETE" }));
    assert.equal(response.status, 200);
    const data = (await response.json()) as { liveBuffer: unknown[] };
    assert.equal(data.liveBuffer.length, 0);
  });

  it("updates storage records via PUT", async () => {
    const { PUT } = await importOrdersRoute();
    const { upsertStorageRecord } = await import("../../src/lib/db");
    upsertStorageRecord({ ...buildPayload(), booked: false });

    const missing = await PUT(
      new Request("https://example.test/api/orders", {
        method: "PUT",
        body: JSON.stringify({ destination: "R9-Z" }),
        headers: { "content-type": "application/json" },
      }),
    );
    assert.equal(missing.status, 400);

    const notFound = await PUT(
      new Request("https://example.test/api/orders", {
        method: "PUT",
        body: JSON.stringify({ trackingId: "UNKNOWN", destination: "R9-Z" }),
        headers: { "content-type": "application/json" },
      }),
    );
    assert.equal(notFound.status, 404);

    const response = await PUT(
      new Request("https://example.test/api/orders", {
        method: "PUT",
        body: JSON.stringify({ trackingId: "TRACK-100", destination: "R2-B", booked: true }),
        headers: { "content-type": "application/json" },
      }),
    );

    assert.equal(response.status, 200);
    const data = (await response.json()) as {
      storage: { destination: string; booked: number };
      liveBuffer: unknown[];
    };
    assert.equal(data.storage.destination, "R2-B");
    assert.equal(data.storage.booked, 1);
    assert.ok(Array.isArray(data.liveBuffer));
  });
});
