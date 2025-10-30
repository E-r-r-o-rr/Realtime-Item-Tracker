import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

import { loadPersistedVlmSettings } from './settingsStore';

export type VlmProviderInfo = {
  mode: 'remote' | 'local';
  providerType?: string;
  modelId?: string;
  baseUrl?: string;
};

export type OcrExtractionResult = {
  kv: Record<string, string>;
  selectedKv: Record<string, string>;
  providerInfo: VlmProviderInfo;
  error?: string;
};

const DEFAULT_MODEL = process.env.OCR_MODEL || 'Qwen/Qwen3-VL-2B-Instruct';
const DEFAULT_LOCAL_MAX_NEW_TOKENS = 512;

// Prefer explicit venv python; fall back to system python
const PY_BIN =
  process.env.OCR_PYTHON ||
  process.env.PYTHON_BIN ||
  (process.platform === 'win32' ? 'python' : 'python3');

const OCR_SCRIPT = path.join(process.cwd(), 'scripts', 'ocr_extract.py');

// 3–5 minutes is safer for first runs / model cold starts
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS || 180_000);

// Set OCR_KEEP=1 to keep tmp output for debugging
const KEEP_TMP = process.env.OCR_KEEP === '1';

const SELECTED_FIELD_ALIASES: Record<string, string[]> = {
  Destination: ['destination', 'destinationwarehouseid', 'destination_warehouse_id'],
  'Item Name': ['item_name', 'itemname', 'product_name', 'product'],
  'Tracking/Order ID': ['tracking_id', 'trackingid', 'order_id', 'orderid', 'item_code', 'trackingorderid'],
  'Truck Number': ['truck_number', 'trucknumber', 'truck_id', 'truckid', 'truck_no', 'truck'],
  'Ship Date': ['ship_date', 'shipdate', 'shipping_date', 'date'],
  'Expected Departure Time': [
    'expected_departure_time',
    'expecteddeparturetime',
    'estimated_departure_time',
    'estimateddeparturetime',
    'departure_time',
    'etd',
  ],
  Origin: ['origin', 'origin_warehouse', 'originwarehouse', 'current_warehouse_id', 'currentwarehouseid'],
};

const SELECTED_CANONICAL_BY_NORMALIZED: Record<string, string> = (() => {
  const entries: Record<string, string> = {};
  for (const [label, aliases] of Object.entries(SELECTED_FIELD_ALIASES)) {
    const normalizedLabel = normalizeLabelKey(label);
    entries[normalizedLabel] = label;
    aliases.forEach((alias) => {
      entries[normalizeLabelKey(alias)] = label;
    });
  }
  return entries;
})();

function normalizeLabelKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sanitizeKvRecord(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = String(rawKey).trim();
    if (!key) continue;

    let value: string;
    if (typeof rawValue === 'string') {
      value = rawValue.trim();
    } else if (rawValue == null) {
      value = '';
    } else if (Array.isArray(rawValue)) {
      value = rawValue
        .map((entry) => (entry == null ? '' : String(entry)))
        .join(', ')
        .trim();
    } else if (typeof rawValue === 'object') {
      try {
        value = JSON.stringify(rawValue);
      } catch (error) {
        value = String(rawValue);
      }
    } else {
      value = String(rawValue).trim();
    }

    result[key] = value;
  }

  return result;
}

function buildSelectedFromAll(all: Record<string, string>): Record<string, string> {
  const normalized = new Map<string, string>();
  for (const [key, value] of Object.entries(all)) {
    const normalizedKey = normalizeLabelKey(key);
    if (!normalizedKey) continue;
    normalized.set(normalizedKey, value);
  }

  const selected: Record<string, string> = {};
  for (const [label, aliases] of Object.entries(SELECTED_FIELD_ALIASES)) {
    let candidate = '';
    for (const alias of aliases) {
      const normalizedAlias = normalizeLabelKey(alias);
      const nextValue = normalized.get(normalizedAlias);
      if (nextValue && nextValue.trim()) {
        candidate = nextValue.trim();
        break;
      }
    }
    selected[label] = candidate;
  }

  return selected;
}

function deriveSelectedKv(all: Record<string, string>, selectedRaw: unknown): Record<string, string> {
  const base = buildSelectedFromAll(all);
  const overrides = sanitizeKvRecord(selectedRaw);
  const merged: Record<string, string> = { ...base };

  for (const [rawKey, rawValue] of Object.entries(overrides)) {
    const trimmedKey = rawKey.trim();
    if (!trimmedKey) continue;
    const normalizedKey = normalizeLabelKey(trimmedKey);
    const canonical = SELECTED_CANONICAL_BY_NORMALIZED[normalizedKey];
    const trimmedValue = rawValue.trim();

    if (canonical) {
      if (trimmedValue) {
        merged[canonical] = trimmedValue;
      }
    } else {
      merged[trimmedKey] = trimmedValue;
    }
  }

  return merged;
}

function rmrf(p: string) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

function deriveOcrErrorMessage(stdout: string, stderr: string, code?: number): string {
  const fallback = code ? `OCR pipeline failed (code ${code})` : 'OCR pipeline failed.';
  const combined = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = combined.length - 1; i >= 0; i -= 1) {
    const line = combined[i];
    if (/^runtimeerror:/i.test(line)) return line;
    if (/^\[fatal\]/i.test(line)) return line.replace(/^\[fatal\]\s*/i, '').trim();
  }

  if (combined.length > 0) {
    return combined[combined.length - 1];
  }

  return fallback;
}

/**
 * Extract key/value pairs using the Python OCR pipeline.
 * Falls back to a stub if the script fails or is missing.
 */
export async function extractKvPairs(filePath: string): Promise<OcrExtractionResult> {
  const vlmSettings = loadPersistedVlmSettings();
  const configuredModel =
    vlmSettings.mode === 'remote'
      ? vlmSettings.remote.modelId?.trim() || DEFAULT_MODEL
      : vlmSettings.local?.modelId?.trim() || DEFAULT_MODEL;

  const providerInfo: VlmProviderInfo = {
    mode: vlmSettings.mode,
  };

  if (vlmSettings.mode === 'remote') {
    const providerType = vlmSettings.remote.providerType;
    const normalizedType = typeof providerType === 'string' ? providerType : undefined;
    const baseUrlRaw = vlmSettings.remote.baseUrl?.trim() ?? '';
    let effectiveBase = baseUrlRaw;
    if (!effectiveBase && normalizedType === 'huggingface') {
      effectiveBase = 'https://router.huggingface.co';
    }

    providerInfo.providerType = normalizedType;
    providerInfo.modelId = vlmSettings.remote.modelId?.trim() || configuredModel;
    providerInfo.baseUrl = effectiveBase;
  } else {
    providerInfo.providerType = 'local';
    providerInfo.modelId = configuredModel;
    providerInfo.baseUrl = '';
  }

  if (!fs.existsSync(OCR_SCRIPT)) {
    console.warn('[ocrService] Python script not found, returning stub.');
    const stubKv = sanitizeKvRecord(stubFromFilename(filePath));
    return { kv: stubKv, selectedKv: deriveSelectedKv(stubKv, {}), providerInfo };
  }

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-out-'));

  const args = [
    OCR_SCRIPT,
    '--image', filePath,
    '--out_dir', outDir,
    '--model', configuredModel,
    // Optional tuning (uncomment if you want explicit control)
    // '--device', process.env.OCR_DEVICE || (process.env.CUDA_VISIBLE_DEVICES ? 'cuda' : 'cpu'),
    // '--dtype', process.env.OCR_DTYPE || 'auto',
    // '--max_pixels', String(process.env.OCR_MAX_PIXELS || 384*384),
    // '--max_new_tokens', String(process.env.OCR_MAX_NEW_TOKENS || 600),
  ];

  const env = { ...process.env };
  env.VLM_MODE = vlmSettings.mode;
  if (vlmSettings.mode === 'remote') {
    env.VLM_REMOTE_CONFIG = JSON.stringify(vlmSettings.remote);
    env.OCR_REQUEST_TIMEOUT_MS = String(vlmSettings.remote.requestTimeoutMs || OCR_TIMEOUT_MS);
    env.OCR_RETRY_MAX = String(vlmSettings.remote.retryPolicy.maxRetries);
    env.OCR_STREAMING = vlmSettings.remote.defaults.streaming ? '1' : '0';
    env.OCR_SYSTEM_PROMPT = vlmSettings.remote.defaults.systemPrompt || '';
    delete env.OCR_LOCAL_MODEL_ID;
    delete env.OCR_LOCAL_DTYPE;
    delete env.OCR_LOCAL_DEVICE_MAP;
    delete env.OCR_LOCAL_MAX_NEW_TOKENS;
    delete env.OCR_LOCAL_FLASH_ATTENTION;
    if (vlmSettings.remote.authScheme !== 'none' && vlmSettings.remote.apiKey) {
      const header = vlmSettings.remote.authHeaderName.toLowerCase();
      if (
        vlmSettings.remote.authScheme === 'bearer' ||
        (vlmSettings.remote.authScheme === 'api-key-header' && header === 'authorization')
      ) {
        env.HF_TOKEN = vlmSettings.remote.apiKey;
      }
    }
  } else {
    delete env.VLM_REMOTE_CONFIG;
    delete env.OCR_REQUEST_TIMEOUT_MS;
    delete env.OCR_RETRY_MAX;
    delete env.OCR_STREAMING;
    delete env.HF_TOKEN;

    const local = vlmSettings.local;
    env.OCR_LOCAL_MODEL_ID = configuredModel;
    if (local.dtype) {
      env.OCR_LOCAL_DTYPE = local.dtype;
    } else {
      delete env.OCR_LOCAL_DTYPE;
    }
    if (local.deviceMap) {
      env.OCR_LOCAL_DEVICE_MAP = local.deviceMap;
    } else {
      delete env.OCR_LOCAL_DEVICE_MAP;
    }
    env.OCR_LOCAL_MAX_NEW_TOKENS = String(local.maxNewTokens || DEFAULT_LOCAL_MAX_NEW_TOKENS);
    env.OCR_LOCAL_FLASH_ATTENTION = local.enableFlashAttention2 ? '1' : '0';
    env.OCR_SYSTEM_PROMPT = vlmSettings.remote.defaults.systemPrompt || '';
  }

  let timer: NodeJS.Timeout | null = null;

  try {
    const { stdout, stderr, code, signal } = await new Promise<{
      stdout: string; stderr: string; code: number; signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      const child = spawn(PY_BIN, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';

      timer = setTimeout(() => {
        try { child.kill(); } catch {} // generic kill works cross-platform
      }, OCR_TIMEOUT_MS);

      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ stdout, stderr, code: code ?? 0, signal }));
    });

    if (timer) { clearTimeout(timer); timer = null; }

    if (code !== 0) {
      const message = deriveOcrErrorMessage(stdout, stderr, code);
      console.warn('[ocrService] OCR script non-zero exit', { code, signal });
      if (stderr) console.warn('[ocrService] stderr:\n' + stderr);
      return { kv: {}, selectedKv: {}, providerInfo, error: message };
    }

    const structuredPath = path.join(outDir, 'structured.json');
    if (fs.existsSync(structuredPath)) {
      const payload = JSON.parse(fs.readFileSync(structuredPath, 'utf-8'));
      // Python writes an array with a single record: { image, llm_raw, llm_parsed }
      if (Array.isArray(payload) && payload.length > 0 && payload[0]?.llm_parsed) {
        const parsed = payload[0].llm_parsed as Record<string, unknown>;
        const allRaw =
          (parsed as { all_key_values?: unknown }).all_key_values ??
          (parsed as { allKeyValues?: unknown }).allKeyValues ??
          parsed;
        const selectedRaw =
          (parsed as { selected_key_values?: unknown }).selected_key_values ??
          (parsed as { selectedKeyValues?: unknown }).selectedKeyValues ??
          {};

        const kv = sanitizeKvRecord(allRaw);
        const selectedKv = deriveSelectedKv(kv, selectedRaw);

        return {
          kv,
          selectedKv,
          providerInfo,
        };
      }
    }

    const message = deriveOcrErrorMessage(stdout, stderr);
    console.warn('[ocrService] structured.json missing or invalid. stderr:\n' + (stderr || '(empty)'));
    return { kv: {}, selectedKv: {}, providerInfo, error: message };
  } catch (err) {
    if (timer) { clearTimeout(timer); }
    console.warn('[ocrService] Error running OCR script:', err);
    const message = err instanceof Error && err.message ? err.message : 'Failed to run OCR script.';
    return { kv: {}, selectedKv: {}, providerInfo, error: message };
  } finally {
    if (!KEEP_TMP) rmrf(outDir);
    else console.log('[ocrService] Keeping temp OCR output at:', outDir);
  }
}

function stubFromFilename(filePath: string): Record<string, string> {
  const basename = path.basename(filePath).toLowerCase();
  const code = basename.replace(/[^a-z0-9]+/g, '').slice(0, 6) || randomUUID().slice(0, 6);
  return {
    item_code: code.toUpperCase(),
    customer: 'Unknown Customer',
    order_date: new Date().toISOString().slice(0, 10),
  };
}
