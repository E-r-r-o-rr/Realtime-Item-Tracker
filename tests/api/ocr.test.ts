import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type {
  buildBarcodeValidation,
  compareBarcodeData,
  extractBarcodes,
} from "../../src/lib/barcodeService";
import type { extractKvPairs } from "../../src/lib/ocrService";

const importFreshRoute = async () =>
  import(`../../src/app/api/ocr/route.ts?test=${Date.now()}-${Math.random()}`) as Promise<
    typeof import("../../src/app/api/ocr/route")
  >;

type OcrRouteOverrides = {
  extractKvPairs?: typeof extractKvPairs;
  extractBarcodes?: typeof extractBarcodes;
  compareBarcodeData?: typeof compareBarcodeData;
  buildBarcodeValidation?: typeof buildBarcodeValidation;
};

const setOcrRouteOverrides = (overrides?: OcrRouteOverrides) => {
  const hook = (globalThis as typeof globalThis & {
    __setOcrRouteTestOverrides?: (overrides?: OcrRouteOverrides) => void;
  }).__setOcrRouteTestOverrides;

  if (!hook) {
    throw new Error("OCR route overrides hook not registered");
  }

  hook(overrides);
};

afterEach(() => {
  mock.restoreAll();
});

describe("POST /api/ocr", () => {
  it("returns 400 when the file field is missing", async () => {
    const { POST } = await importFreshRoute();

    const form = new FormData();
    const request = new Request("https://example.test/api/ocr", {
      method: "POST",
      body: form,
    });

    const response = await POST(request);
    assert.equal(response.status, 400);
    const data = (await response.json()) as { error: string };
    assert.equal(data.error, "Missing file field");
  });

  it("returns OCR and barcode metadata on success", async () => {
    const route = await importFreshRoute();
    setOcrRouteOverrides({
      extractKvPairs: async () => ({
        kv: { destination: "R1-A" },
        selectedKv: { "Tracking/Order ID": "ABC123" },
        providerInfo: { mode: "local", execution: "local-service" },
      }),
      extractBarcodes: async () => ({
        entries: [
          { text: "ABC123", symbology: "code128", corners: [] },
          { text: "", symbology: "code128", corners: [] },
        ],
        warnings: ["low-contrast"],
      }),
      compareBarcodeData: () => ({ match: true }),
      buildBarcodeValidation: () => ({ matches: true, status: "match", message: "All good" }),
    });

    const file = new File([Buffer.from("image-bytes")], "ticket.png", { type: "image/png" });
    const form = new FormData();
    form.set("file", file);
    const request = new Request("https://example.test/api/ocr", {
      method: "POST",
      body: form,
    });

    try {
      const response = await route.POST(request);
      assert.equal(response.status, 200);
      const data = (await response.json()) as Record<string, unknown>;
      assert.deepEqual(data.kv, { destination: "R1-A" });
      assert.deepEqual(data.selectedKv, { "Tracking/Order ID": "ABC123" });
      assert.deepEqual(data.barcodes, ["ABC123"]);
      assert.deepEqual(data.barcodeWarnings, ["low-contrast"]);
      assert.deepEqual(data.barcodeComparison, { match: true });
      assert.deepEqual(data.validation, { matches: true, status: "match", message: "All good" });
      assert.deepEqual(data.providerInfo, { mode: "local", execution: "local-service" });
    } finally {
      setOcrRouteOverrides();
    }
  });

  it("skips barcode extraction when barcode validation is disabled", async () => {
    const route = await importFreshRoute();
    const extractBarcodesMock = mock.fn(async () => ({ entries: [{ text: "SHOULD_NOT" }], warnings: [] }));
    const compareBarcodeDataMock = mock.fn(async () => ({ match: false }));
    const buildBarcodeValidationMock = mock.fn(() => ({ matches: false, status: "mismatch", message: "should not run" }));

    setOcrRouteOverrides({
      extractKvPairs: async () => ({
        kv: { destination: "R1-A" },
        selectedKv: {},
        providerInfo: { mode: "local", execution: "local-cli" },
      }),
      extractBarcodes: extractBarcodesMock as any,
      compareBarcodeData: compareBarcodeDataMock as any,
      buildBarcodeValidation: buildBarcodeValidationMock as any,
    });

    const file = new File([Buffer.from("image-bytes")], "ticket.png", { type: "image/png" });
    const form = new FormData();
    form.set("file", file);
    form.set("barcodeDisabled", "true");
    const request = new Request("https://example.test/api/ocr", {
      method: "POST",
      body: form,
    });

    try {
      const response = await route.POST(request);
      assert.equal(response.status, 200);
      const data = (await response.json()) as Record<string, unknown>;
      assert.deepEqual(data.kv, { destination: "R1-A" });
      assert.deepEqual(data.barcodes, []);
      assert.deepEqual(data.barcodeWarnings, []);
      assert.equal(data.barcodeComparison, null);
      assert.deepEqual(data.validation, {
        matches: null,
        status: "disabled",
        message: "Barcode validation disabled for this scan.",
      });
      assert.equal(extractBarcodesMock.mock.callCount(), 0);
      assert.equal(compareBarcodeDataMock.mock.callCount(), 0);
      assert.equal(buildBarcodeValidationMock.mock.callCount(), 0);
    } finally {
      setOcrRouteOverrides();
    }
  });

  it("returns 502 when the provider reports an error", async () => {
    const providerInfo = { mode: "remote", execution: "remote-http" };
    const route = await importFreshRoute();
    setOcrRouteOverrides({
      extractKvPairs: async () => ({
        kv: undefined as any,
        selectedKv: undefined as any,
        providerInfo,
        error: "upstream failure",
      }),
      extractBarcodes: async () => ({ entries: [], warnings: [] }),
      compareBarcodeData: () => ({}),
      buildBarcodeValidation: () => ({}),
    });
    const file = new File([Buffer.from("image")], "ticket.png", { type: "image/png" });
    const form = new FormData();
    form.set("file", file);
    const request = new Request("https://example.test/api/ocr", {
      method: "POST",
      body: form,
    });

    try {
      const response = await route.POST(request);
      assert.equal(response.status, 502);
      const data = (await response.json()) as { error: string; providerInfo: unknown };
      assert.equal(data.error, "upstream failure");
      assert.deepEqual(data.providerInfo, providerInfo);
    } finally {
      setOcrRouteOverrides();
    }
  });

  it("returns 500 on unexpected failures", async () => {
    const route = await importFreshRoute();
    setOcrRouteOverrides({
      extractKvPairs: async () => {
        throw new Error("crash");
      },
      extractBarcodes: async () => ({ entries: [], warnings: [] }),
      compareBarcodeData: () => ({}),
      buildBarcodeValidation: () => ({}),
    });
    const file = new File([Buffer.from("image")], "ticket.png", { type: "image/png" });
    const form = new FormData();
    form.set("file", file);
    const request = new Request("https://example.test/api/ocr", {
      method: "POST",
      body: form,
    });

    try {
      const response = await route.POST(request);
      assert.equal(response.status, 500);
      const data = (await response.json()) as { error: string };
      assert.equal(data.error, "Internal server error");
    } finally {
      setOcrRouteOverrides();
    }
  });
});
