import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, mock } from "node:test";

import { DEFAULT_VLM_SETTINGS } from "@/config/vlm";

afterEach(() => {
  mock.restoreAll();
});

describe("ocrService helpers", () => {
  it("sanitizes arbitrary key/value payloads", async () => {
    const { sanitizeKvRecord } = await import("@/lib/ocrService");
    const result = sanitizeKvRecord({
      " Dest ": " R1 ",
      empty: " ",
      list: ["A", null, 42],
      nested: { foo: "bar" },
      nil: null,
    });

    assert.deepEqual(result, {
      Dest: "R1",
      empty: "",
      list: "A, , 42",
      nested: "{\"foo\":\"bar\"}",
      nil: "",
    });
  });

  it("derives canonical selected values from aliases", async () => {
    const { deriveSelectedKv } = await import("@/lib/ocrService");
    const kv = {
      destination: "R5-D",
      item_code: "ABC123",
      ship_date: "2025-02-01",
    };

    const selected = deriveSelectedKv(kv, {
      tracking_id: "ABC123",
      "Custom Field": "value",
    });

    assert.equal(selected["Destination"], "R5-D");
    assert.equal(selected["Tracking/Order ID"], "ABC123");
    assert.equal(selected["Ship Date"], "2025-02-01");
    assert.equal(selected["Custom Field"], "value");
  });

  it("prefers fatal or runtime errors when deriving OCR failures", async () => {
    const { deriveOcrErrorMessage } = await import("@/lib/ocrService");
    const message = deriveOcrErrorMessage("info\nRuntimeError: pipeline crashed", "", 1);
    assert.equal(message, "RuntimeError: pipeline crashed");
  });
});

describe("extractKvPairs", () => {
  it("returns parsed results from the running local service", async () => {
    const settings = structuredClone(DEFAULT_VLM_SETTINGS);
    settings.mode = "local";

    const { extractKvPairs, __setOcrServiceTestOverrides } = await import(
      `@/lib/ocrService?local-${Date.now()}`,
    );
    __setOcrServiceTestOverrides({
      loadSettings: () => settings,
      getServiceStatus: () => ({
        state: "running" as const,
        host: "127.0.0.1",
        port: 5117,
        modelId: "stub-model",
      }),
      invokeLocal: async () => ({
        ok: true,
        source: "local-service" as const,
        durationMs: 42,
        result: {
          image: "demo.png",
          llm_raw: "{}",
          llm_parsed: {
            all_key_values: {
              destination: "R9-A",
              item_code: "ZXCVB1",
              origin: "Dock 7",
            },
            selected_key_values: {
              tracking_id: "ZXCVB1",
              destination: "R9-A",
            },
          },
        },
      }),
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-test-"));
    const imagePath = path.join(tmpDir, "ticket.png");
    fs.writeFileSync(imagePath, "stub");

    try {
      const result = await extractKvPairs(imagePath);

      assert.deepEqual(result.kv, {
        destination: "R9-A",
        item_code: "ZXCVB1",
        origin: "Dock 7",
      });
      assert.equal(result.selectedKv["Tracking/Order ID"], "ZXCVB1");
      assert.equal(result.providerInfo.execution, "local-service");
      assert.ok(result.providerInfo.executionDebug);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      __setOcrServiceTestOverrides();
    }
  });

  it("falls back to stub data when the Python script is missing", async () => {
    const settings = structuredClone(DEFAULT_VLM_SETTINGS);
    settings.mode = "remote";

    const realExists = fs.existsSync;
    mock.method(fs, "existsSync", (target: fs.PathLike) => {
      if (typeof target === "string" && target.includes(`${path.sep}scripts${path.sep}ocr_extract.py`)) {
        return false;
      }
      return realExists(target);
    });

    const { extractKvPairs, __setOcrServiceTestOverrides } = await import(
      `@/lib/ocrService?stub-${Date.now()}`,
    );
    __setOcrServiceTestOverrides({
      loadSettings: () => settings,
      getServiceStatus: () => ({
        state: "stopped" as const,
        host: "127.0.0.1",
        port: 5117,
        message: "Service stopped",
      }),
      invokeLocal: async () => ({ ok: false, message: "stopped" }),
    });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-test-missing-"));
    const imagePath = path.join(tmpDir, "ABC123-ticket.png");
    fs.writeFileSync(imagePath, "stub");

    try {
      const result = await extractKvPairs(imagePath);

      assert.ok(result.kv.item_code);
      assert.equal(result.selectedKv["Tracking/Order ID"], "ABC123");
      assert.equal(result.providerInfo.mode, "remote");
      assert.equal(result.providerInfo.execution, "remote-http");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      __setOcrServiceTestOverrides();
    }
  });
});
