import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import React from "react";

import {
  clickElement,
  findByTextContains,
  setInputValue,
  setupDom,
} from "../helpers/dom";

const modulePath = "@/components/scanner/dashboard";

let cleanup: (() => void) | undefined;

beforeEach(() => {
  const handle = setupDom();
  cleanup = handle.cleanup;
});

afterEach(() => {
  mock.restoreAll();
  cleanup?.();
  cleanup = undefined;
});

test("displays the latest live buffer after a successful scan", async () => {
  mock.module("@/components/scanner/floor-map-viewer", () => ({
    FloorMapViewer: () => null,
  }));

  const liveRecord = {
    destination: "Dock 12",
    itemName: "Widget Pallet",
    trackingId: "TRK-9",
    truckNumber: "Truck-77",
    shipDate: "2025-02-14",
    expectedDepartureTime: "08:30",
    originLocation: "Depot A",
  };

  const fetchMock = mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method?.toUpperCase() ?? (typeof input === "object" && "method" in input ? (input as Request).method : "GET");

    if (url.includes("/api/orders") && method === "GET") {
      return new Response(JSON.stringify({ liveBuffer: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/api/orders") && method === "POST") {
      return new Response(
        JSON.stringify({
          record: liveRecord,
          historyEntry: {
            id: 1,
            trackingId: liveRecord.trackingId,
            status: "saved",
            recordedAt: new Date().toISOString(),
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.includes("/api/floor-maps")) {
      return new Response(JSON.stringify({ maps: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/api/ocr")) {
      return new Response(
        JSON.stringify({
          kv: {
            destination: liveRecord.destination,
            item_name: liveRecord.itemName,
            tracking_id: liveRecord.trackingId,
            truck_number: liveRecord.truckNumber,
            ship_date: liveRecord.shipDate,
            expected_departure_time: liveRecord.expectedDepartureTime,
            origin: liveRecord.originLocation,
          },
          selectedKv: {
            destination: liveRecord.destination,
            item_name: liveRecord.itemName,
            tracking_id: liveRecord.trackingId,
            truck_number: liveRecord.truckNumber,
            ship_date: liveRecord.shipDate,
            expected_departure_time: liveRecord.expectedDepartureTime,
            origin: liveRecord.originLocation,
          },
          validation: {
            status: "match",
            message: "Barcode and OCR values align.",
            matches: true,
          },
          providerInfo: { name: "Stub Provider", mode: "remote" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const ScannerDashboard = (await import(modulePath)).default;

  await act(async () => {
    root.render(React.createElement(ScannerDashboard));
  });

  const fileInput = document.querySelector("input[type='file']");
  const scanButton = findByTextContains(document.body as any, "Scan document");
  assert.ok(fileInput && scanButton, "should render upload controls");

  const file = new File(["stub"], "manifest.png", { type: "image/png" });
  Object.defineProperty(fileInput, "files", {
    value: [file],
    writable: false,
    configurable: true,
  });

  setInputValue(fileInput as any, "C:/fakepath/manifest.png");

  await act(async () => {
    clickElement(scanButton as any);
    await Promise.resolve();
  });

  // Allow asynchronous fetch handlers and state updates to settle.
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const header = findByTextContains(document.body as any, "Live buffer (latest scan)");
  assert.ok(header, "should display live buffer card");

  const destinationCell = findByTextContains(document.body as any, liveRecord.destination);
  const trackingCell = findByTextContains(document.body as any, liveRecord.trackingId);
  assert.ok(destinationCell && trackingCell, "should render latest scan details");

  assert.ok(fetchMock.mock.calls.some((call) => String(call.arguments[0]).includes("/api/ocr")), "should call OCR endpoint");
  assert.ok(fetchMock.mock.calls.some((call) => String(call.arguments[0]).includes("/api/orders")), "should sync orders endpoint");

  container.remove();
});

test("allows cancelling a scanned order sheet", async () => {
  mock.module("@/components/scanner/floor-map-viewer", () => ({
    FloorMapViewer: () => null,
  }));

  const liveRecord = {
    destination: "Dock 21",
    itemName: "Cooling Fans",
    trackingId: "CN-552", // ensure trackingId for DELETE request
    truckNumber: "Carrier-12",
    shipDate: "2025-04-11",
    expectedDepartureTime: "09:15",
    originLocation: "South Hub",
  };

  const abortableDelay = (signal: AbortSignal | undefined, ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (!signal) {
        setTimeout(resolve, ms);
        return;
      }
      const createAbortError = () => {
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        return abortError;
      };
      if (signal.aborted) {
        reject(createAbortError());
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(createAbortError());
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal.addEventListener("abort", onAbort);
    });

  const fetchMock = mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method?.toUpperCase() ?? (typeof input === "object" && "method" in input ? (input as Request).method : "GET");

    if (url.includes("/api/orders") && method === "GET") {
      return new Response(JSON.stringify({ liveBuffer: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/api/orders") && method === "POST") {
      if (init?.signal?.aborted) {
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        throw abortError;
      }
      return new Response(
        JSON.stringify({
          record: liveRecord,
          historyEntry: {
            id: 5,
            trackingId: liveRecord.trackingId,
            status: "saved",
            recordedAt: new Date().toISOString(),
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.includes("/api/orders") && method === "DELETE") {
      return new Response(JSON.stringify({ liveBuffer: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/api/floor-maps")) {
      return new Response(JSON.stringify({ maps: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/api/ocr")) {
      await abortableDelay(init?.signal, 50);
      return new Response(
        JSON.stringify({
          kv: {
            destination: liveRecord.destination,
            item_name: liveRecord.itemName,
            tracking_id: liveRecord.trackingId,
            truck_number: liveRecord.truckNumber,
            ship_date: liveRecord.shipDate,
            expected_departure_time: liveRecord.expectedDepartureTime,
            origin: liveRecord.originLocation,
          },
          selectedKv: {
            destination: liveRecord.destination,
            item_name: liveRecord.itemName,
            tracking_id: liveRecord.trackingId,
            truck_number: liveRecord.truckNumber,
            ship_date: liveRecord.shipDate,
            expected_departure_time: liveRecord.expectedDepartureTime,
            origin: liveRecord.originLocation,
          },
          validation: {
            status: "match",
            message: "Barcode and OCR values align.",
            matches: true,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const ScannerDashboard = (await import(modulePath)).default;

  await act(async () => {
    root.render(React.createElement(ScannerDashboard));
  });

  const fileInput = document.querySelector("input[type='file']");
  const scanButton = findByTextContains(document.body as any, "Scan document");
  assert.ok(fileInput && scanButton, "should render upload controls");

  const file = new File(["stub"], "order.png", { type: "image/png" });
  Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
  setInputValue(fileInput as any, "C:/fakepath/order.png");

  await act(async () => {
    clickElement(scanButton as any);
    await Promise.resolve();
  });

  const inFlightCancel = findByTextContains(document.body as any, "Cancel scan");
  assert.ok(inFlightCancel, "should show cancel control while scan is running");

  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const cancelButton = findByTextContains(document.body as any, "Cancel scan");
  assert.ok(cancelButton, "should show cancel control once data is loaded");

  await act(async () => {
    clickElement(cancelButton as any);
    await Promise.resolve();
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const cancellationStatus = findByTextContains(document.body as any, "Scan cancelled");
  assert.ok(cancellationStatus, "should show cancellation status message");

  const inputAfterCancel = fileInput as HTMLInputElement;
  assert.equal(inputAfterCancel.value, "", "should reset file input value after cancellation");

  const deleteCall = fetchMock.mock.calls.find((call) => {
    const [input, init] = call.arguments;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method?.toUpperCase() ?? (typeof input === "object" && "method" in input ? (input as Request).method : "GET");
    return url.includes("/api/orders") && method === "DELETE";
  });
  assert.ok(deleteCall, "should call delete endpoint to cancel scan");

  const textContent = document.body.textContent ?? "";
  assert.ok(!textContent.includes(liveRecord.itemName), "should remove scanned details after cancellation");

  const nextFile = new File(["stub2"], "order-2.png", { type: "image/png" });
  Object.defineProperty(fileInput, "files", { value: [nextFile], configurable: true });
  setInputValue(fileInput as any, "C:/fakepath/order-2.png");

  await act(async () => {
    clickElement(scanButton as any);
    await Promise.resolve();
  });

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });

  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const historyMessage = findByTextContains(document.body as any, "Saved to history");
  assert.ok(historyMessage, "should process subsequent scans after cancellation");

  const ocrCalls = fetchMock.mock.calls.filter((call) => String(call.arguments[0]).includes("/api/ocr"));
  assert.ok(ocrCalls.length >= 2, "should attempt OCR again after cancelling");

  container.remove();
});
