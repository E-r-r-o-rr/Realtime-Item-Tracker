import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_VLM_SETTINGS } from "@/config/vlm";

import { useTestDatabase } from "../helpers/db";

useTestDatabase();

describe("settingsStore", () => {
  it("returns defaults when no settings are persisted", async () => {
    const modulePath = `@/lib/settingsStore?defaults-${Date.now()}`;
    const { loadPersistedVlmSettings } = await import(modulePath);
    const loaded = loadPersistedVlmSettings();
    assert.deepEqual(loaded, DEFAULT_VLM_SETTINGS);
  });

  it("persists updates and merges with defaults", async () => {
    const modulePath = `@/lib/settingsStore?persist-${Date.now()}`;
    const { loadPersistedVlmSettings, saveVlmSettings } = await import(modulePath);

    const settings = structuredClone(DEFAULT_VLM_SETTINGS);
    settings.remote.baseUrl = "https://api.test/v2";
    settings.remote.extraHeaders = [
      { id: "1", key: "X-Test", value: "one" },
    ];
    settings.local.modelId = "Custom/Model";

    saveVlmSettings(settings);

    const reloaded = loadPersistedVlmSettings();
    assert.equal(reloaded.remote.baseUrl, "https://api.test/v2");
    assert.equal(reloaded.remote.extraHeaders[0]?.key, "X-Test");
    assert.equal(reloaded.local.modelId, "Custom/Model");
    assert.equal(reloaded.remote.defaults.stopSequences.length, settings.remote.defaults.stopSequences.length);
  });

  it("falls back to defaults when persisted JSON is invalid", async () => {
    const modulePath = `@/lib/settingsStore?invalid-${Date.now()}`;
    const { loadPersistedVlmSettings, saveVlmSettings } = await import(modulePath);
    const { getDb } = await import("@/lib/db");

    saveVlmSettings(DEFAULT_VLM_SETTINGS);
    const db = getDb();
    db.prepare(`UPDATE app_settings SET value = ? WHERE key = ?`).run("{not-json}", "vlm_settings");

    const loaded = loadPersistedVlmSettings();
    assert.deepEqual(loaded, DEFAULT_VLM_SETTINGS);
  });
});

describe("normalizeVlmSettings", () => {
  it("normalizes remote and local payloads", async () => {
    const { normalizeVlmSettings } = await import(`@/lib/vlmSettings?norm-${Date.now()}`);

    const normalized = normalizeVlmSettings({
      mode: "remote",
      remote: {
        providerType: "huggingface",
        baseUrl: "https://api-inference.huggingface.co/models",
        capabilities: {
          chat: false,
          maxContextTokens: "4096",
        },
        defaults: {
          stopSequences: "END\nSTOP",
          temperature: "0.7",
        },
        extraHeaders: [
          { key: "X-One", value: "1" },
          { key: "", value: "" },
        ],
        logging: {
          promptLogging: "full",
          costTracking: {
            inputPrice: "1.5",
            outputPrice: 2,
            currency: "eur",
          },
        },
      },
      local: {
        modelId: "  qwen ",
        dtype: "float16",
        deviceMap: "cuda",
        maxNewTokens: "1024",
        enableFlashAttention2: "true",
      },
    });

    assert.equal(normalized.mode, "remote");
    assert.equal(normalized.remote.baseUrl, "https://router.huggingface.co/models");
    assert.equal(normalized.remote.capabilities.chat, false);
    assert.equal(normalized.remote.capabilities.maxContextTokens, 4096);
    assert.deepEqual(normalized.remote.defaults.stopSequences, ["END", "STOP"]);
    assert.equal(normalized.remote.defaults.temperature, 0.7);
    assert.equal(normalized.remote.extraHeaders.length, 1);
    assert.equal(normalized.remote.logging.promptLogging, "full");
    assert.equal(normalized.remote.logging.costTracking.currency, "EUR");
    assert.equal(normalized.local.modelId, "qwen");
    assert.equal(normalized.local.enableFlashAttention2, true);
    assert.equal(normalized.local.maxNewTokens, 1024);
  });
});
