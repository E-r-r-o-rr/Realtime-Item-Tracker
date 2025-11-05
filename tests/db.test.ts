import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  __resetDbForTests,
  clearHistory,
  clearStorageAndBookings,
  getBookingByTrackingId,
  ingestLiveBufferEntry,
  listHistory,
  listLiveBuffer,
  upsertStorageRecord,
  updateStorageRecord,
} from "@/lib/db";
import type { LogisticsFields } from "@/lib/db";

const originalCwd = process.cwd();
let tempDir: string;

function buildPayload(overrides: Partial<LogisticsFields> = {}): LogisticsFields {
  return {
    destination: "R1-A",
    itemName: "Widget Alpha",
    trackingId: "TRACK-123",
    truckNumber: "TRK-1",
    shipDate: "2025-05-10",
    expectedDepartureTime: "08:45",
    originLocation: "Dock 1",
    ...overrides,
  } satisfies LogisticsFields;
}

describe("database logistics workflows", { concurrency: false }, () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rit-db-test-"));
    process.chdir(tempDir);
    __resetDbForTests();
  });

  afterEach(() => {
    __resetDbForTests();
    process.chdir(originalCwd);
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("persists booked storage rows into the bookings table", () => {
    const payload = buildPayload();

    const storage = upsertStorageRecord({ ...payload, booked: true });

    assert.equal(storage.booked, 1);
    const booking = getBookingByTrackingId(payload.trackingId);
    assert.ok(booking);
    assert.equal(booking?.destination, payload.destination);
    assert.equal(booking?.itemName, payload.itemName);
  });

  it("updates storage details and clears bookings when unbooked", () => {
    const payload = buildPayload();
    upsertStorageRecord({ ...payload, booked: true });

    const updated = updateStorageRecord(payload.trackingId, {
      destination: "R2-B",
      expectedDepartureTime: "12:30",
      booked: false,
    });

    assert.ok(updated);
    assert.equal(updated?.destination, "R2-B");
    assert.equal(updated?.booked, 0);
    assert.equal(updated?.expectedDepartureTime, "12:30");
    const booking = getBookingByTrackingId(payload.trackingId);
    assert.equal(booking, undefined);
  });

  it("ingests live buffer scans using booking details and records history", () => {
    const payload = buildPayload();
    const stored = upsertStorageRecord({ ...payload, booked: true });

    const result = ingestLiveBufferEntry({
      ...buildPayload({
        destination: "Override", // should be replaced by booking/storage values
        itemName: "Override Item",
      }),
      trackingId: payload.trackingId,
    });

    assert.ok(result.record);
    assert.equal(result.record?.destination, stored.destination);
    assert.equal(result.record?.itemName, stored.itemName);
    assert.equal(result.message, undefined);

    const liveBuffer = listLiveBuffer();
    assert.equal(liveBuffer.length, 1);
    assert.equal(liveBuffer[0]?.trackingId, stored.trackingId);

    const history = listHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0]?.trackingId, stored.trackingId);
  });

  it("notes when bookings are missing during ingestion", () => {
    clearStorageAndBookings();
    clearHistory();
    const payload = buildPayload({ trackingId: "TRACK-404", truckNumber: "TRK-9" });

    const result = ingestLiveBufferEntry(payload);

    assert.ok(result.record);
    assert.equal(result.record?.trackingId, payload.trackingId);
    assert.equal(result.message, "Booked item not found");
    const history = listHistory();
    assert.equal(history.length, 1);
  });
});
