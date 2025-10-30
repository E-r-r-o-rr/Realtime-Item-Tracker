import { DEFAULT_VLM_SETTINGS } from "@/config/vlm";
import { VlmSettings } from "@/types/vlm";
import { getDb } from "./db";

const SETTINGS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

const VLM_SETTINGS_KEY = "vlm_settings";

function ensureSettingsTable() {
  const db = getDb();
  db.exec(SETTINGS_TABLE_SQL);
}

export function loadPersistedVlmSettings(): VlmSettings {
  ensureSettingsTable();
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(VLM_SETTINGS_KEY) as { value?: string } | undefined;

  if (!row?.value) {
    return structuredClone(DEFAULT_VLM_SETTINGS);
  }

  try {
    const parsed = JSON.parse(row.value) as VlmSettings;
    return {
      ...structuredClone(DEFAULT_VLM_SETTINGS),
      ...parsed,
      remote: {
        ...structuredClone(DEFAULT_VLM_SETTINGS.remote),
        ...parsed.remote,
        capabilities: {
          ...structuredClone(DEFAULT_VLM_SETTINGS.remote.capabilities),
          ...parsed.remote?.capabilities,
        },
        defaults: {
          ...structuredClone(DEFAULT_VLM_SETTINGS.remote.defaults),
          ...parsed.remote?.defaults,
          stopSequences:
            Array.isArray(parsed.remote?.defaults?.stopSequences)
              ? parsed.remote!.defaults!.stopSequences!
              : structuredClone(DEFAULT_VLM_SETTINGS.remote.defaults.stopSequences),
        },
        rateLimits: {
          ...structuredClone(DEFAULT_VLM_SETTINGS.remote.rateLimits),
          ...parsed.remote?.rateLimits,
        },
        retryPolicy: {
          ...structuredClone(DEFAULT_VLM_SETTINGS.remote.retryPolicy),
          ...parsed.remote?.retryPolicy,
        },
        circuitBreaker: {
          ...structuredClone(DEFAULT_VLM_SETTINGS.remote.circuitBreaker),
          ...parsed.remote?.circuitBreaker,
        },
        parameterMapping: {
          ...structuredClone(DEFAULT_VLM_SETTINGS.remote.parameterMapping),
          ...parsed.remote?.parameterMapping,
        },
        logging: {
          ...structuredClone(DEFAULT_VLM_SETTINGS.remote.logging),
          ...parsed.remote?.logging,
          costTracking: {
            ...structuredClone(DEFAULT_VLM_SETTINGS.remote.logging.costTracking),
            ...parsed.remote?.logging?.costTracking,
          },
        },
        ocr: {
          ...structuredClone(DEFAULT_VLM_SETTINGS.remote.ocr),
          ...parsed.remote?.ocr,
        },
        extraHeaders: Array.isArray(parsed.remote?.extraHeaders)
          ? parsed.remote!.extraHeaders!
          : [],
      },
    };
  } catch (error) {
    console.error("Failed to parse persisted VLM settings", error);
    return structuredClone(DEFAULT_VLM_SETTINGS);
  }
}

export function saveVlmSettings(settings: VlmSettings) {
  ensureSettingsTable();
  const db = getDb();
  const payload = JSON.stringify(settings);
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).run(VLM_SETTINGS_KEY, payload);
}
