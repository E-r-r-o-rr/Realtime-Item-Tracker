import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, mock } from "node:test";

afterEach(() => {
  mock.restoreAll();
  delete process.env.BARCODE_TIMEOUT_MS;
});

describe("barcodeService", () => {
  it("reports a clean match when comparison summary contains only matches", async () => {
    const { buildBarcodeValidation } = await import("@/lib/barcodeService");
    const extraction = {
      entries: [
        {
          text: "ABC123",
        },
      ],
      warnings: [],
    };
    const comparison = {
      rows: [],
      summary: { matched: 2, mismatched: 0, missing: 0 },
      library: { entriesCount: 2, missedByOcrCount: 0, missedByOcr: [] },
      barcodeText: "ABC123",
    };

    const result = buildBarcodeValidation({ tracking_id: "ABC123" }, extraction, comparison);
    assert.equal(result.status, "match");
    assert.equal(result.matches, true);
    assert.match(result.message, /2 fields matched/);
    assert.equal(result.comparedValue, "ABC123");
  });

  it("returns no_barcode when the extraction yields no entries", async () => {
    const { buildBarcodeValidation } = await import("@/lib/barcodeService");
    const extraction = { entries: [], warnings: ["none"] };
    const result = buildBarcodeValidation({ tracking_id: "ZXCV" }, extraction, null);
    assert.equal(result.status, "no_barcode");
    assert.equal(result.matches, null);
    assert.match(result.message, /No barcode values detected/);
  });

  it("flags mismatches when no comparison results are available", async () => {
    const { buildBarcodeValidation } = await import("@/lib/barcodeService");
    const extraction = {
      entries: [
        {
          text: "ZXCV",
        },
      ],
      warnings: [],
    };

    const result = buildBarcodeValidation({ tracking_id: "ZXCV" }, extraction, null);
    assert.equal(result.status, "mismatch");
    assert.equal(result.matches, null);
    assert.ok(result.message.includes("Unable to compare"));
    assert.equal(result.comparedValue, "ZXCV");
  });

  it("falls back to stub data when the decoder times out", async () => {
    process.env.BARCODE_TIMEOUT_MS = "5";
    const realExists = fs.existsSync;
    mock.method(fs, "existsSync", (target: fs.PathLike) => {
      if (typeof target === "string" && target.endsWith(`${path.sep}barcode_decode.py`)) {
        return true;
      }
      return realExists(target);
    });

    mock.method(childProcess, "spawn", () => {
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const child = new EventEmitter() as childProcess.ChildProcessWithoutNullStreams;
      Object.assign(child, {
        stdout,
        stderr,
        stdin: null,
        pid: 1234,
        killed: false,
        exitCode: null,
        kill: mock.fn(() => {
          if ((child as any).killed) return true;
          (child as any).killed = true;
          queueMicrotask(() => {
            child.emit("close", 1, "SIGKILL");
          });
          return true;
        }),
      });
      return child;
    });

    const { extractBarcodes } = await import(`@/lib/barcodeService?timeout-${Date.now()}`);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "barcode-test-"));
    const imagePath = path.join(tmpDir, "ABC123.png");

    try {
      const result = await extractBarcodes(imagePath);
      assert.equal(result.entries.length, 0);
      assert.ok(result.warnings.some((warning) => warning.includes("No barcode values detected")));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
