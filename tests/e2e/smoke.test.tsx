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

test("auth flow sets a session cookie and redirects home", async () => {
  const push = mock.fn();
  const refresh = mock.fn();

  mock.module("next/navigation", () => ({
    useRouter: () => ({ push, refresh }),
    useSearchParams: () => new URLSearchParams(),
  }));

  const fetchMock = mock.method(globalThis, "fetch", async () => {
    document.cookie = "session=test-token; Path=/";
    return new Response("{}", {
      status: 200,
      headers: { "Set-Cookie": "session=test-token; Path=/" },
    });
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const { LoginForm } = await import("@/components/auth/login-form");

  await act(async () => {
    root.render(React.createElement(LoginForm));
  });

  const usernameInput = document.querySelector("input#username");
  const passwordInput = document.querySelector("input#password");
  const submitButton = findByTextContains(document.body as any, "Sign in");
  assert.ok(usernameInput && passwordInput && submitButton);

  setInputValue(usernameInput as any, "admin");
  setInputValue(passwordInput as any, "admin");

  await act(async () => {
    clickElement(submitButton as any);
    await Promise.resolve();
  });

  assert.equal(fetchMock.mock.callCount(), 1, "should send login request");
  assert.equal(push.mock.callCount(), 1, "should navigate after login");
  assert.equal(push.mock.calls[0].arguments[0], "/", "should redirect to the dashboard");
  assert.equal(refresh.mock.callCount(), 1, "should refresh router context");
  assert.ok(document.cookie.includes("session=test-token"), "should store session cookie");

  container.remove();
});

test("scanner dashboard workflow updates live buffer", async () => {
  mock.module("@/components/scanner/floor-map-viewer", () => ({ FloorMapViewer: () => null }));

  const liveRecord = {
    destination: "Dock 18",
    itemName: "Calibration Kit",
    trackingId: "RT-8821",
    truckNumber: "Fleet-11",
    shipDate: "2025-03-03",
    expectedDepartureTime: "15:45",
    originLocation: "Northern Hub",
  };

  mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method?.toUpperCase() ?? (typeof input === "object" && "method" in input ? (input as Request).method : "GET");

    if (url.includes("/api/orders") && method === "GET") {
      return new Response(JSON.stringify({ liveBuffer: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/api/orders") && method === "POST") {
      return new Response(JSON.stringify({ record: liveRecord }), {
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
          validation: { status: "match", message: "Synced" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const ScannerDashboard = (await import("@/components/scanner/dashboard")).default;

  await act(async () => {
    root.render(React.createElement(ScannerDashboard));
  });

  const fileInput = document.querySelector("input[type='file']");
  const scanButton = findByTextContains(document.body as any, "Scan document");
  assert.ok(fileInput && scanButton);

  const file = new File(["stub"], "scan.png", { type: "image/png" });
  Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
  setInputValue(fileInput as any, "C:/fakepath/scan.png");

  await act(async () => {
    clickElement(scanButton as any);
    await Promise.resolve();
  });

  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const trackingCell = findByTextContains(document.body as any, liveRecord.trackingId);
  const originCell = findByTextContains(document.body as any, liveRecord.originLocation);
  assert.ok(trackingCell && originCell, "should render live buffer details after scan");

  container.remove();
});
