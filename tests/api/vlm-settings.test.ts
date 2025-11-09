import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, describe, it, mock } from "node:test";

import { DEFAULT_VLM_SETTINGS } from "@/config/vlm";
import type { LocalServiceRuntime } from "@/lib/localVlmService";
import type { VlmSettings } from "@/types/vlm";

const importRoute = async <T>(path: string) =>
  (await import(`../../src/app/api/settings/${path}?test=${Date.now()}-${Math.random()}`)) as T;

afterEach(() => {
  mock.restoreAll();
});

describe("/api/settings/vlm", () => {
  it("returns persisted settings", async () => {
    const settings: VlmSettings = { ...structuredClone(DEFAULT_VLM_SETTINGS), mode: "local" };
    const route = await importRoute<typeof import("../../src/app/api/settings/vlm/route")>("vlm/route.ts");
    route.__setVlmRouteTestOverrides({ loadPersistedVlmSettings: () => settings });

    try {
      const response = await route.GET();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const data = (await response.json()) as { settings: VlmSettings };
      assert.equal(data.settings.mode, "local");
    } finally {
      route.__setVlmRouteTestOverrides();
    }
  });

  it("normalizes updates and stops the running service when configs change", async () => {
    const normalized: VlmSettings = {
      ...structuredClone(DEFAULT_VLM_SETTINGS),
      mode: "local",
      local: { ...DEFAULT_VLM_SETTINGS.local, modelId: "custom", enableFlashAttention2: true },
    };

    const save = mock.fn();
    const stop = mock.fn(async () => {});
    const runtime: LocalServiceRuntime = {
      state: "running",
      host: "127.0.0.1",
      port: 5117,
      config: {
        modelId: "other",
        dtype: "fp16",
        deviceMap: "cpu",
        maxNewTokens: 256,
        attnImpl: "",
        systemPrompt: "",
      },
    };

    const route = await importRoute<typeof import("../../src/app/api/settings/vlm/route")>("vlm/route.ts");
    route.__setVlmRouteTestOverrides({
      normalizeVlmSettings: () => normalized,
      saveVlmSettings: save,
      getLocalVlmServiceStatus: () => runtime,
      stopLocalVlmService: stop,
    });

    try {
      const response = await route.PUT(
        new Request("https://example.test/api/settings/vlm", {
          method: "PUT",
          body: JSON.stringify({ mode: "local" }),
          headers: { "content-type": "application/json" },
        }) as any,
      );

      assert.equal(response.status, 200);
      const data = (await response.json()) as { settings: VlmSettings };
      assert.equal(data.settings.local.modelId, "custom");
      assert.equal(save.mock.callCount(), 1);
      assert.equal(stop.mock.callCount(), 1);
    } finally {
      route.__setVlmRouteTestOverrides();
    }
  });

  it("resets settings via POST", async () => {
    const save = mock.fn();
    const stop = mock.fn(async () => {});
    const route = await importRoute<typeof import("../../src/app/api/settings/vlm/route")>("vlm/route.ts");
    route.__setVlmRouteTestOverrides({
      saveVlmSettings: save,
      stopLocalVlmService: stop,
    });

    try {
      const response = await route.POST(
        new Request("https://example.test/api/settings/vlm", {
          method: "POST",
          body: JSON.stringify({ action: "reset" }),
          headers: { "content-type": "application/json" },
        }) as any,
      );

      assert.equal(response.status, 200);
      const data = (await response.json()) as { reset: boolean; settings: VlmSettings };
      assert.equal(data.reset, true);
      assert.deepEqual(data.settings, DEFAULT_VLM_SETTINGS);
      assert.equal(stop.mock.callCount(), 1);
      assert.equal(save.mock.callCount(), 1);
    } finally {
      route.__setVlmRouteTestOverrides();
    }
  });

  it("rejects unsupported actions", async () => {
    const route = await importRoute<typeof import("../../src/app/api/settings/vlm/route")>("vlm/route.ts");

    const response = await route.POST(
      new Request("https://example.test/api/settings/vlm", {
        method: "POST",
        body: JSON.stringify({ action: "noop" }),
        headers: { "content-type": "application/json" },
      }) as any,
    );

    assert.equal(response.status, 400);
    const data = (await response.json()) as { error: string };
    assert.equal(data.error, "Unsupported action");
  });
});

describe("/api/settings/vlm/local/service", () => {
  it("reports runtime status", async () => {
    const status: LocalServiceRuntime = { state: "stopped", host: "127.0.0.1", port: 5117 };
    const route = await importRoute<typeof import("../../src/app/api/settings/vlm/local/service/route")>(
      "vlm/local/service/route.ts",
    );
    route.__setLocalServiceRouteTestOverrides({ getLocalVlmServiceStatus: () => status });

    try {
      const response = await route.GET();
      assert.equal(response.status, 200);
      const data = (await response.json()) as { status: LocalServiceRuntime };
      assert.equal(data.status.state, "stopped");
    } finally {
      route.__setLocalServiceRouteTestOverrides();
    }
  });

  it("starts the service with normalized payload", async () => {
    const captured: unknown[][] = [];
    const start = mock.fn(async (...args: unknown[]) => {
      captured.push(args);
      return { state: "starting", host: "127.0.0.1", port: 5117 };
    });
    const route = await importRoute<typeof import("../../src/app/api/settings/vlm/local/service/route")>(
      "vlm/local/service/route.ts",
    );
    route.__setLocalServiceRouteTestOverrides({ startLocalVlmService: start });

    try {
      const response = await route.POST(
        new Request("https://example.test/api/settings/vlm/local/service", {
          method: "POST",
          body: JSON.stringify({ modelId: " Model ", maxNewTokens: "1024", enableFlashAttention2: "true" }),
          headers: { "content-type": "application/json" },
        }) as any,
      );

      assert.equal(response.status, 200);
      const [localSettings, prompt] = captured[0] as [typeof DEFAULT_VLM_SETTINGS.local, string];
      assert.equal(localSettings.modelId, "Model");
      assert.equal(localSettings.maxNewTokens, 1024);
      assert.equal(localSettings.enableFlashAttention2, true);
      assert.equal(prompt, "");
    } finally {
      route.__setLocalServiceRouteTestOverrides();
    }
  });

  it("propagates start failures", async () => {
    const route = await importRoute<typeof import("../../src/app/api/settings/vlm/local/service/route")>(
      "vlm/local/service/route.ts",
    );
    route.__setLocalServiceRouteTestOverrides({
      startLocalVlmService: async () => {
        throw new Error("boom");
      },
    });

    try {
      const response = await route.POST(
        new Request("https://example.test/api/settings/vlm/local/service", {
          method: "POST",
          body: JSON.stringify({ modelId: "broken" }),
          headers: { "content-type": "application/json" },
        }) as any,
      );

      assert.equal(response.status, 500);
      const data = (await response.json()) as { ok: boolean };
      assert.equal(data.ok, false);
    } finally {
      route.__setLocalServiceRouteTestOverrides();
    }
  });

  it("stops the service", async () => {
    const stop = mock.fn(async () => true);
    const route = await importRoute<typeof import("../../src/app/api/settings/vlm/local/service/route")>(
      "vlm/local/service/route.ts",
    );
    route.__setLocalServiceRouteTestOverrides({ stopLocalVlmService: stop });

    try {
      const response = await route.DELETE();
      assert.equal(response.status, 200);
      const data = (await response.json()) as { ok: boolean };
      assert.equal(data.ok, true);
      assert.equal(stop.mock.callCount(), 1);
    } finally {
      route.__setLocalServiceRouteTestOverrides();
    }
  });
});

describe("/api/settings/vlm/local/check", () => {
  it("requires a model id", async () => {
    const route = await importRoute<typeof import("../../src/app/api/settings/vlm/local/check/route")>(
      "vlm/local/check/route.ts",
    );
    route.__setLocalCheckRouteTestOverrides({ existsSync: () => true });

    const response = await route.POST(
      new Request("https://example.test/api/settings/vlm/local/check", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }) as any,
    );
    assert.equal(response.status, 400);
  });

  it("fails when the OCR script is missing", async () => {
    const route = await importRoute<typeof import("../../src/app/api/settings/vlm/local/check/route")>(
      "vlm/local/check/route.ts",
    );
    route.__setLocalCheckRouteTestOverrides({ existsSync: () => false });

    try {
      const response = await route.POST(
        new Request("https://example.test/api/settings/vlm/local/check", {
          method: "POST",
          body: JSON.stringify({ modelId: "model" }),
          headers: { "content-type": "application/json" },
        }) as any,
      );
      assert.equal(response.status, 500);
    } finally {
      route.__setLocalCheckRouteTestOverrides();
    }
  });

  it("reports success when the child exits cleanly", async () => {
    const route = await importRoute<typeof import("../../src/app/api/settings/vlm/local/check/route")>(
      "vlm/local/check/route.ts",
    );

    class MockChild extends EventEmitter {
      stdout = new EventEmitter();
      stderr = new EventEmitter();
      kill() {
        return true;
      }
    }

    route.__setLocalCheckRouteTestOverrides({
      existsSync: () => true,
      spawn: () => {
        const child = new MockChild();
        process.nextTick(() => {
          child.stdout.emit("data", Buffer.from("cache ok"));
          child.emit("close", 0);
        });
        return child as any;
      },
    });

    try {
      const response = await route.POST(
        new Request("https://example.test/api/settings/vlm/local/check", {
          method: "POST",
          body: JSON.stringify({ modelId: "model" }),
          headers: { "content-type": "application/json" },
        }) as any,
      );

      assert.equal(response.status, 200);
      const data = (await response.json()) as { ok: boolean; message: string };
      assert.equal(data.ok, true);
      assert.ok(data.message.includes("cache"));
    } finally {
      route.__setLocalCheckRouteTestOverrides();
    }
  });

  it("surfaces non-zero exit codes", async () => {
    const route = await importRoute<typeof import("../../src/app/api/settings/vlm/local/check/route")>(
      "vlm/local/check/route.ts",
    );

    class MockChild extends EventEmitter {
      stdout = new EventEmitter();
      stderr = new EventEmitter();
      kill() {
        return true;
      }
    }

    route.__setLocalCheckRouteTestOverrides({
      existsSync: () => true,
      spawn: () => {
        const child = new MockChild();
        process.nextTick(() => {
          child.stderr.emit("data", Buffer.from("missing weights"));
          child.emit("close", 1);
        });
        return child as any;
      },
    });

    try {
      const response = await route.POST(
        new Request("https://example.test/api/settings/vlm/local/check", {
          method: "POST",
          body: JSON.stringify({ modelId: "model" }),
          headers: { "content-type": "application/json" },
        }) as any,
      );
      assert.equal(response.status, 400);
      const data = (await response.json()) as { ok: boolean; message: string };
      assert.equal(data.ok, false);
      assert.ok(data.message.includes("missing"));
    } finally {
      route.__setLocalCheckRouteTestOverrides();
    }
  });

  it("handles spawn errors", async () => {
    const route = await importRoute<typeof import("../../src/app/api/settings/vlm/local/check/route")>(
      "vlm/local/check/route.ts",
    );

    route.__setLocalCheckRouteTestOverrides({
      existsSync: () => true,
      spawn: () => {
        const child = new EventEmitter();
        process.nextTick(() => {
          child.emit("error", new Error("spawn failed"));
        });
        return child as any;
      },
    });

    try {
      const response = await route.POST(
        new Request("https://example.test/api/settings/vlm/local/check", {
          method: "POST",
          body: JSON.stringify({ modelId: "model" }),
          headers: { "content-type": "application/json" },
        }) as any,
      );
      assert.equal(response.status, 500);
      const data = (await response.json()) as { ok: boolean };
      assert.equal(data.ok, false);
    } finally {
      route.__setLocalCheckRouteTestOverrides();
    }
  });
});

describe("/api/settings/vlm/test", () => {
  it("short-circuits when local mode is active", async () => {
    const route = await importRoute<typeof import("../../src/app/api/settings/vlm/test/route")>("vlm/test/route.ts");
    route.__setVlmTestRouteOverrides({
      loadPersistedVlmSettings: () => ({ ...structuredClone(DEFAULT_VLM_SETTINGS), mode: "local" }),
    });

    try {
      const response = await route.POST(new Request("https://example.test/api/settings/vlm/test", { method: "POST" }) as any);
      assert.equal(response.status, 200);
      const data = (await response.json()) as { ok: boolean; mode: string };
      assert.equal(data.ok, true);
      assert.equal(data.mode, "local");
    } finally {
      route.__setVlmTestRouteOverrides();
    }
  });

  it("validates Hugging Face requirements", async () => {
    const route = await importRoute<typeof import("../../src/app/api/settings/vlm/test/route")>("vlm/test/route.ts");
    const settings: VlmSettings = {
      ...structuredClone(DEFAULT_VLM_SETTINGS),
      mode: "remote",
      remote: {
        ...structuredClone(DEFAULT_VLM_SETTINGS.remote),
        providerType: "huggingface",
        modelId: "",
        apiKey: "",
        hfProvider: "provider",
      },
    };
    route.__setVlmTestRouteOverrides({ normalizeVlmSettings: () => settings });

    try {
      const response = await route.POST(
        new Request("https://example.test/api/settings/vlm/test", {
          method: "POST",
          body: JSON.stringify({ settings }),
          headers: { "content-type": "application/json" },
        }) as any,
      );
      assert.equal(response.status, 400);
      const data = (await response.json()) as { ok: boolean; message: string };
      assert.equal(data.ok, false);
      assert.ok(data.message.includes("Model ID"));
    } finally {
      route.__setVlmTestRouteOverrides();
    }
  });

  it("tests remote endpoints with fetch", async () => {
    const route = await importRoute<typeof import("../../src/app/api/settings/vlm/test/route")>("vlm/test/route.ts");
    const settings: VlmSettings = {
      ...structuredClone(DEFAULT_VLM_SETTINGS),
      mode: "remote",
      remote: {
        ...structuredClone(DEFAULT_VLM_SETTINGS.remote),
        baseUrl: "https://api.example.test/health",
        apiKey: "token",
      },
    };
    route.__setVlmTestRouteOverrides({ normalizeVlmSettings: () => settings });

    const fetchMock = mock.fn(async () => new Response(null, { status: 204, statusText: "No Content" }));
    mock.method(globalThis, "fetch", fetchMock as any);

    try {
      const response = await route.POST(
        new Request("https://example.test/api/settings/vlm/test", {
          method: "POST",
          body: JSON.stringify({ settings }),
          headers: { "content-type": "application/json" },
        }) as any,
      );
      assert.equal(response.status, 200);
      const data = (await response.json()) as { ok: boolean; status: number };
      assert.equal(data.ok, true);
      assert.equal(data.status, 204);
      assert.equal(fetchMock.mock.callCount(), 1);
    } finally {
      route.__setVlmTestRouteOverrides();
    }
  });

  it("handles remote fetch failures", async () => {
    const route = await importRoute<typeof import("../../src/app/api/settings/vlm/test/route")>("vlm/test/route.ts");
    const settings: VlmSettings = {
      ...structuredClone(DEFAULT_VLM_SETTINGS),
      mode: "remote",
      remote: {
        ...structuredClone(DEFAULT_VLM_SETTINGS.remote),
        baseUrl: "https://api.example.test/health",
      },
    };
    route.__setVlmTestRouteOverrides({ normalizeVlmSettings: () => settings });

    mock.method(globalThis, "fetch", mock.fn(async () => {
      throw new Error("timeout");
    }) as any);

    try {
      const response = await route.POST(
        new Request("https://example.test/api/settings/vlm/test", {
          method: "POST",
          body: JSON.stringify({ settings }),
          headers: { "content-type": "application/json" },
        }) as any,
      );
      assert.equal(response.status, 502);
      const data = (await response.json()) as { ok: boolean; message: string };
      assert.equal(data.ok, false);
      assert.ok(data.message.includes("Network"));
    } finally {
      route.__setVlmTestRouteOverrides();
    }
  });
});
