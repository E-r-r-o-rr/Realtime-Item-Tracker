import { DEFAULT_VLM_SETTINGS } from "@/config/vlm";
import { VlmSettings } from "@/types/vlm";
import { normalizeVlmSettings } from "./vlmSettings";
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
    const parsed = JSON.parse(row.value) as unknown;
    return normalizeVlmSettings(parsed);
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
