import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { afterEach, describe, it, mock } from "node:test";

class MockChildProcess extends EventEmitter implements childProcess.ChildProcessWithoutNullStreams {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = null as any;
  killed = false;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  pid = 4321;

  kill = mock.fn((signal?: NodeJS.Signals) => {
    if (this.killed) return true;
    this.killed = true;
    this.signalCode = signal ?? null;
    queueMicrotask(() => {
      this.exitCode = signal ? null : 0;
      this.emit("exit", this.exitCode, signal ?? null);
    });
    return true;
  });
}

afterEach(() => {
  mock.restoreAll();
  delete process.env.OCR_LOCAL_SERVICE_READY_TIMEOUT_MS;
});

describe("localVlmService", () => {
  it("starts the local service and reports a running status", async () => {
    process.env.OCR_LOCAL_SERVICE_READY_TIMEOUT_MS = "200";
    const realExists = fs.existsSync;
    mock.method(fs, "existsSync", (target: fs.PathLike) => {
      if (typeof target === "string" && target.endsWith("ocr_local_service.py")) {
        return true;
      }
      return realExists(target);
    });

    const child = new MockChildProcess();
    mock.method(childProcess, "spawn", () => child);

    const fetchCalls: URL[] = [];
    const fetchMock = mock.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? new URL(input) : new URL(input.toString());
      fetchCalls.push(url);
      return {
        ok: true,
        json: async () => ({ startedAt: Date.now() / 1000 }),
      } as any;
    });
    mock.method(globalThis, "fetch", fetchMock as any);

    const modulePath = `@/lib/localVlmService?ok-${Date.now()}`;
    const { startLocalVlmService, getLocalVlmServiceStatus, stopLocalVlmService } = await import(modulePath);

    const status = await startLocalVlmService(
      {
        modelId: "",
        dtype: "",
        deviceMap: "",
        maxNewTokens: 256,
        enableFlashAttention2: false,
      },
      "",
    );

    assert.equal(status.state, "running");
    assert.ok(fetchCalls[0]?.pathname.endsWith("/health"));

    const stopResult = await stopLocalVlmService();
    assert.equal(stopResult, true);
    const finalStatus = getLocalVlmServiceStatus();
    assert.equal(finalStatus.state, "stopped");
  });

  it("throws when the local service script is missing", async () => {
    mock.method(fs, "existsSync", () => false);
    const modulePath = `@/lib/localVlmService?missing-${Date.now()}`;
    const { startLocalVlmService } = await import(modulePath);

    await assert.rejects(
      () =>
        startLocalVlmService(
          {
            modelId: "",
            dtype: "",
            deviceMap: "",
            maxNewTokens: 256,
            enableFlashAttention2: false,
          },
          "",
        ),
      /Local service script is missing/,
    );
  });

  it("times out when the service never reports healthy", async () => {
    process.env.OCR_LOCAL_SERVICE_READY_TIMEOUT_MS = "10";
    const realExists = fs.existsSync;
    mock.method(fs, "existsSync", (target: fs.PathLike) => {
      if (typeof target === "string" && target.endsWith("ocr_local_service.py")) {
        return true;
      }
      return realExists(target);
    });

    const child = new MockChildProcess();
    mock.method(childProcess, "spawn", () => child);

    mock.method(globalThis, "fetch", mock.fn(async () => {
      throw new Error("connection refused");
    }) as any);

    const modulePath = `@/lib/localVlmService?timeout-${Date.now()}`;
    const { startLocalVlmService, stopLocalVlmService } = await import(modulePath);

    await assert.rejects(
      () =>
        startLocalVlmService(
          {
            modelId: "",
            dtype: "",
            deviceMap: "",
            maxNewTokens: 128,
            enableFlashAttention2: false,
          },
          "",
        ),
      /Timed out waiting for local model service/,
    );

    const stopped = await stopLocalVlmService();
    assert.equal(stopped, true);
  });
});
