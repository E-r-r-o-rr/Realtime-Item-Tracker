import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { useTestDatabase } from "../helpers/db";

const importStorageRoute = async () =>
  import(`../../src/app/api/storage/route.ts?test=${Date.now()}-${Math.random()}`) as Promise<
    typeof import("../../src/app/api/storage/route")
  >;

const importStorageIdRoute = async () =>
  import(`../../src/app/api/storage/[trackingId]/route.ts?test=${Date.now()}-${Math.random()}`) as Promise<
    typeof import("../../src/app/api/storage/[trackingId]/route")
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
  trackingId: "TRACK-55",
  truckNumber: "TRUCK-7",
  shipDate: "2025-05-11",
  expectedDepartureTime: "09:00",
  originLocation: "Dock 2",
  ...overrides,
});

describe("storage API routes", { concurrency: false }, () => {
  useTestDatabase();

  it("seeds storage when empty", async () => {
    const { GET } = await importStorageRoute();
    const response = await GET();
    assert.equal(response.status, 200);
    const data = (await response.json()) as { storage: unknown[]; bookings: unknown[] };
    assert.ok(data.storage.length > 0);
    assert.ok(Array.isArray(data.bookings));
  });

  it("creates new storage records", async () => {
    const { POST } = await importStorageRoute();
    const response = await POST(
      new Request("https://example.test/api/storage", {
        method: "POST",
        body: JSON.stringify({ ...buildPayload(), booked: true }),
        headers: { "content-type": "application/json" },
      }),
    );

    assert.equal(response.status, 201);
    const data = (await response.json()) as { storage: { trackingId: string; booked: boolean } };
    assert.equal(data.storage.trackingId, "TRACK-55");
    assert.equal(data.storage.booked, true);
  });

  it("validates required fields", async () => {
    const { POST } = await importStorageRoute();
    const response = await POST(
      new Request("https://example.test/api/storage", {
        method: "POST",
        body: JSON.stringify({ ...buildPayload(), originLocation: "" }),
        headers: { "content-type": "application/json" },
      }),
    );

    assert.equal(response.status, 400);
    const data = (await response.json()) as { error: string };
    assert.equal(data.error, "Missing required field: originLocation");
  });

  it("supports seeding sample data via POST", async () => {
    const { POST } = await importStorageRoute();
    const response = await POST(
      new Request("https://example.test/api/storage", {
        method: "POST",
        body: JSON.stringify({ action: "seed", count: 3 }),
        headers: { "content-type": "application/json" },
      }),
    );

    assert.equal(response.status, 200);
    const data = (await response.json()) as { storage: unknown[]; bookings: unknown[] };
    assert.equal(data.storage.length, 3);
  });

  it("clears storage and bookings", async () => {
    const { POST, DELETE, GET } = await importStorageRoute();
    await POST(
      new Request("https://example.test/api/storage", {
        method: "POST",
        body: JSON.stringify({ ...buildPayload(), trackingId: "TRACK-X" }),
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await DELETE();
    assert.equal(response.status, 200);
    const data = (await response.json()) as { storage: unknown[]; bookings: unknown[] };
    assert.equal(data.storage.length, 0);
    assert.equal(data.bookings.length, 0);

    const verify = await GET();
    const verifyData = (await verify.json()) as { storage: unknown[] };
    assert.ok(Array.isArray(verifyData.storage));
  });

  it("updates storage records via PATCH", async () => {
    const { POST } = await importStorageRoute();
    const { PATCH } = await importStorageIdRoute();

    await POST(
      new Request("https://example.test/api/storage", {
        method: "POST",
        body: JSON.stringify({ ...buildPayload() }),
        headers: { "content-type": "application/json" },
      }),
    );

    const missing = await PATCH(new Request("https://example.test/api/storage/TRACK-55", { method: "PATCH" }), {
      params: Promise.resolve({ trackingId: "" }),
    });
    assert.equal(missing.status, 400);

    const notFound = await PATCH(
      new Request("https://example.test/api/storage/UNKNOWN", {
        method: "PATCH",
        body: JSON.stringify({ destination: "R9-Z" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ trackingId: "UNKNOWN" }) },
    );
    assert.equal(notFound.status, 404);

    const response = await PATCH(
      new Request("https://example.test/api/storage/TRACK-55", {
        method: "PATCH",
        body: JSON.stringify({ destination: "R3-C", booked: true }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ trackingId: "TRACK-55" }) },
    );

    assert.equal(response.status, 200);
    const data = (await response.json()) as { storage: { destination: string; booked: boolean } };
    assert.equal(data.storage.destination, "R3-C");
    assert.equal(data.storage.booked, true);
  });

  it("deletes storage entries via tracking id", async () => {
    const { POST } = await importStorageRoute();
    const { DELETE } = await importStorageIdRoute();

    await POST(
      new Request("https://example.test/api/storage", {
        method: "POST",
        body: JSON.stringify({ ...buildPayload({ trackingId: "TRACK-Z" }) }),
        headers: { "content-type": "application/json" },
      }),
    );

    const missing = await DELETE(new Request("https://example.test/api/storage/TRACK-Z", { method: "DELETE" }), {
      params: Promise.resolve({ trackingId: "" }),
    });
    assert.equal(missing.status, 400);

    const response = await DELETE(
      new Request("https://example.test/api/storage/TRACK-Z", { method: "DELETE" }),
      { params: Promise.resolve({ trackingId: "TRACK-Z" }) },
    );
    assert.equal(response.status, 200);
    const data = (await response.json()) as { storage: unknown[]; bookings: unknown[] };
    assert.equal(data.storage.length, 0);
    assert.equal(data.bookings.length, 0);
  });

  it("removes booked entries from bookings when deleted", async () => {
    const { POST } = await importStorageRoute();
    const { DELETE } = await importStorageIdRoute();

    await POST(
      new Request("https://example.test/api/storage", {
        method: "POST",
        body: JSON.stringify({ ...buildPayload({ trackingId: "TRACK-BOOKED" }), booked: true }),
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await DELETE(
      new Request("https://example.test/api/storage/TRACK-BOOKED", { method: "DELETE" }),
      { params: Promise.resolve({ trackingId: "TRACK-BOOKED" }) },
    );

    assert.equal(response.status, 200);
    const data = (await response.json()) as { bookings: unknown[] };
    assert.equal(data.bookings.length, 0);
  });
});
