import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createHash, randomUUID } from 'crypto';

import { loadPersistedVlmSettings } from './settingsStore';
import {
  getLocalVlmServiceStatus,
  invokeLocalService,
} from './localVlmService';

type LoadSettingsFn = typeof loadPersistedVlmSettings;
type GetServiceStatusFn = typeof getLocalVlmServiceStatus;
type InvokeLocalFn = typeof invokeLocalService;


type OcrExecutionProfile = 'fast' | 'balanced' | 'accurate';

const OCR_CACHE_TTL_MS = Number(process.env.OCR_CACHE_TTL_MS || 10 * 60 * 1000);
const OCR_CACHE_MAX_ITEMS = Number(process.env.OCR_CACHE_MAX_ITEMS || 100);

type CachedOcrResult = {
  expiresAt: number;
  value: OcrExtractionResult;
};

const ocrResultCache = new Map<string, CachedOcrResult>();

function cloneOcrResult(result: OcrExtractionResult): OcrExtractionResult {
  return {
    kv: { ...result.kv },
    selectedKv: { ...result.selectedKv },
    providerInfo: {
      ...result.providerInfo,
      executionDebug: result.providerInfo.executionDebug ? [...result.providerInfo.executionDebug] : undefined,
    },
    error: result.error,
  };
}

function trimCache() {
  const now = Date.now();
  for (const [key, entry] of ocrResultCache.entries()) {
    if (entry.expiresAt <= now) {
      ocrResultCache.delete(key);
    }
  }

  while (ocrResultCache.size > OCR_CACHE_MAX_ITEMS) {
    const oldest = ocrResultCache.keys().next();
    if (oldest.done) break;
    ocrResultCache.delete(oldest.value);
  }
}

function buildOcrCacheKey(filePath: string, profile: OcrExecutionProfile): string | null {
  try {
    const stat = fs.statSync(filePath);
    const seed = `${filePath}:${stat.size}:${stat.mtimeMs}:${profile}`;
    return createHash('sha1').update(seed).digest('hex');
  } catch {
    return null;
  }
}

function tryParseLooseObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const noFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  const firstBrace = noFence.indexOf('{');
  const lastBrace = noFence.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const snippet = noFence.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(snippet);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {}
  }

  const linePairs: Record<string, string> = {};
  for (const line of noFence.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:]+):\s*(.+)\s*$/);
    if (!match) continue;
    linePairs[match[1].trim()] = match[2].trim();
  }

  return Object.keys(linePairs).length > 0 ? linePairs : null;
}

function deriveKvFromLlmRaw(rawPayload: unknown): Record<string, string> {
  if (typeof rawPayload !== 'string') return {};
  const parsed = tryParseLooseObject(rawPayload);
  if (!parsed) return {};
  const record = parsed as Record<string, unknown>;
  const nested =
    (record as { all_key_values?: unknown }).all_key_values ??
    (record as { allKeyValues?: unknown }).allKeyValues ??
    record;
  return sanitizeKvRecord(nested);
}

let loadSettingsFn: LoadSettingsFn = loadPersistedVlmSettings;
let getServiceStatusFn: GetServiceStatusFn = getLocalVlmServiceStatus;
let invokeLocalFn: InvokeLocalFn = invokeLocalService;

export function __setOcrServiceTestOverrides(overrides?: {
  loadSettings?: LoadSettingsFn;
  getServiceStatus?: GetServiceStatusFn;
  invokeLocal?: InvokeLocalFn;
}): void {
  loadSettingsFn = overrides?.loadSettings ?? loadPersistedVlmSettings;
  getServiceStatusFn = overrides?.getServiceStatus ?? getLocalVlmServiceStatus;
  invokeLocalFn = overrides?.invokeLocal ?? invokeLocalService;
}

export type VlmProviderInfo = {
  mode: 'remote' | 'local';
  providerType?: string;
  modelId?: string;
  baseUrl?: string;
  execution?: 'remote-http' | 'local-service' | 'local-cli';
  executionDebug?: string[];
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

export function normalizeLabelKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function sanitizeKvRecord(input: unknown): Record<string, string> {
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

export function deriveSelectedKv(all: Record<string, string>, selectedRaw: unknown): Record<string, string> {
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

export function deriveOcrErrorMessage(stdout: string, stderr: string, code?: number): string {
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
export async function extractKvPairs(filePath: string, options?: { profile?: OcrExecutionProfile }): Promise<OcrExtractionResult> {
  const profile: OcrExecutionProfile = options?.profile ?? 'balanced';
  trimCache();
  const cacheKey = buildOcrCacheKey(filePath, profile);
  if (cacheKey) {
    const cached = ocrResultCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      const cloned = cloneOcrResult(cached.value);
      cloned.providerInfo.executionDebug = [
        ...(cloned.providerInfo.executionDebug ?? []),
        `[cache] Reused ${profile} profile result.`,
      ];
      return cloned;
    }
  }
  const vlmSettings = loadSettingsFn();
  const configuredModel =
    vlmSettings.mode === 'remote'
      ? vlmSettings.remote.modelId?.trim() || DEFAULT_MODEL
      : vlmSettings.local?.modelId?.trim() || DEFAULT_MODEL;
  const usingLocalMode = vlmSettings.mode === 'local';
  const localDebug: string[] = [];
  const errorTrail: string[] = [];

  const appendErrorTrail = (message: string) => {
    const trimmed = typeof message === 'string' ? message.trim() : '';
    if (!trimmed) return;
    errorTrail.push(trimmed);
  };

  const buildErrorMessage = (primary: string) => {
    const trimmedPrimary = primary.trim();
    if (errorTrail.length === 0) {
      return trimmedPrimary;
    }

    const parts = [...errorTrail];
    if (trimmedPrimary) {
      parts.push(trimmedPrimary);
    }

    return parts.join(' ');
  };

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
    providerInfo.execution = 'remote-http';
  } else {
    providerInfo.providerType = 'local';
    providerInfo.modelId = configuredModel;
    providerInfo.baseUrl = '';
    providerInfo.execution = 'local-cli';
  }

  if (usingLocalMode) {
    const serviceStatus = getServiceStatusFn();
    if (serviceStatus.state !== 'running') {
      const stateMessage =
        serviceStatus.state === 'stopped'
          ? 'Local model service is not running.'
          : `Local model service state is ${serviceStatus.state}.`;
      const debugLine = `[local-service] ${stateMessage}`;
      localDebug.push(debugLine);
      appendErrorTrail(stateMessage);
      if (serviceStatus.message) {
        localDebug.push(`[local-service] ${serviceStatus.message}`);
        appendErrorTrail(serviceStatus.message);
      }
      console.info('[ocrService] Local service unavailable:', {
        state: serviceStatus.state,
        message: serviceStatus.message,
      });
    } else {
      localDebug.push(
        `[local-service] Running on ${serviceStatus.host}:${serviceStatus.port} (model=${serviceStatus.modelId || 'unknown'})`,
      );
      try {
        const inference = await invokeLocalFn(filePath, {
          normalizeDates: true,
        });
        if (inference.ok && inference.result?.llm_parsed) {
          const parsed = inference.result.llm_parsed as Record<string, unknown>;
          const allRaw =
            (parsed as { all_key_values?: unknown }).all_key_values ??
            (parsed as { allKeyValues?: unknown }).allKeyValues ??
            parsed;
          const selectedRaw =
            (parsed as { selected_key_values?: unknown }).selected_key_values ??
            (parsed as { selectedKeyValues?: unknown }).selectedKeyValues ??
            {};

          const kv = sanitizeKvRecord(allRaw);
          const rawFallbackKv = deriveKvFromLlmRaw((inference.result as { llm_raw?: unknown }).llm_raw);
          const mergedKv = { ...rawFallbackKv, ...kv };
          const selectedKv = deriveSelectedKv(mergedKv, selectedRaw);

          if (typeof inference.durationMs === 'number') {
            localDebug.push(
              `[local-service] Completed in ${inference.durationMs}ms (source=${inference.source || 'n/a'})`,
            );
          } else {
            localDebug.push(`[local-service] Completed (source=${inference.source || 'n/a'})`);
          }

          providerInfo.execution = inference.source === 'local-service' ? 'local-service' : 'local-cli';
          if (localDebug.length > 0) {
            providerInfo.executionDebug = [...localDebug];
          }
          const result = {
            kv: mergedKv,
            selectedKv,
            providerInfo,
          };
          if (cacheKey) {
            ocrResultCache.set(cacheKey, { expiresAt: Date.now() + OCR_CACHE_TTL_MS, value: cloneOcrResult(result) });
          }
          return result;
        }

        if (!inference.ok) {
          const failureMessage = inference.message || 'Local service returned an unknown error.';
          localDebug.push(`[local-service] Call failed: ${failureMessage}`);
          console.warn('[ocrService] Local service inference failed:', failureMessage);
          appendErrorTrail(`Local service inference failed: ${failureMessage}`);
        } else {
          localDebug.push('[local-service] No parsed payload returned.');
          console.warn('[ocrService] Local service returned no parsed payload.');
          appendErrorTrail('Local service returned no parsed payload.');
        }
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : String(error);
        localDebug.push(`[local-service] Exception: ${errMessage}`);
        console.warn('[ocrService] Local service call failed; falling back to CLI.', error);
        appendErrorTrail(`Local service call failed: ${errMessage}`);
      }
    }

    if (localDebug.length > 0) {
      providerInfo.executionDebug = [...localDebug];
    }
  }

  if (!fs.existsSync(OCR_SCRIPT)) {
    console.warn('[ocrService] Python script not found, returning stub.');
    const stubKv = sanitizeKvRecord(stubFromFilename(filePath));
    if (usingLocalMode) {
      localDebug.push('[local-cli] Python script missing; returning stub result.');
      providerInfo.executionDebug = [...localDebug];
    }
    const result = { kv: stubKv, selectedKv: deriveSelectedKv(stubKv, {}), providerInfo };
    if (cacheKey) {
      ocrResultCache.set(cacheKey, { expiresAt: Date.now() + OCR_CACHE_TTL_MS, value: cloneOcrResult(result) });
    }
    return result;
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
    const remoteTimeout =
      profile === 'fast'
        ? Math.min(vlmSettings.remote.requestTimeoutMs || OCR_TIMEOUT_MS, 60_000)
        : profile === 'accurate'
        ? Math.max(vlmSettings.remote.requestTimeoutMs || OCR_TIMEOUT_MS, OCR_TIMEOUT_MS)
        : vlmSettings.remote.requestTimeoutMs || OCR_TIMEOUT_MS;
    env.OCR_REQUEST_TIMEOUT_MS = String(remoteTimeout);
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
    const localTokens =
      profile === 'fast'
        ? Math.min(local.maxNewTokens || DEFAULT_LOCAL_MAX_NEW_TOKENS, 320)
        : profile === 'accurate'
        ? Math.max(local.maxNewTokens || DEFAULT_LOCAL_MAX_NEW_TOKENS, 768)
        : local.maxNewTokens || DEFAULT_LOCAL_MAX_NEW_TOKENS;
    env.OCR_LOCAL_MAX_NEW_TOKENS = String(localTokens);
    env.OCR_LOCAL_FLASH_ATTENTION = local.enableFlashAttention2 ? '1' : '0';
    env.OCR_SYSTEM_PROMPT = vlmSettings.remote.defaults.systemPrompt || '';
  }

  let timer: NodeJS.Timeout | null = null;

  try {
    if (usingLocalMode) {
      localDebug.push(`[local-cli] Running fallback CLI pipeline for ${configuredModel}`);
      providerInfo.executionDebug = [...localDebug];
    }
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
      const combinedMessage = buildErrorMessage(message);
      console.warn('[ocrService] OCR script non-zero exit', { code, signal });
      if (stderr) console.warn('[ocrService] stderr:\n' + stderr);
      if (usingLocalMode) {
        localDebug.push(`[local-cli] Pipeline exited with code ${code}${signal ? ` (signal ${signal})` : ''}.`);
        providerInfo.executionDebug = [...localDebug];
      }
      return { kv: {}, selectedKv: {}, providerInfo, error: combinedMessage };
    }

    const structuredPath = path.join(outDir, 'structured.json');
    if (fs.existsSync(structuredPath)) {
      const payload = JSON.parse(fs.readFileSync(structuredPath, 'utf-8'));
      console.info('[ocrService] Raw OCR structured payload:', payload);
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
        const rawFallbackKv = deriveKvFromLlmRaw((payload[0] as { llm_raw?: unknown }).llm_raw);
        const mergedKv = { ...rawFallbackKv, ...kv };
        const selectedKv = deriveSelectedKv(mergedKv, selectedRaw);

        if (usingLocalMode) {
          localDebug.push('[local-cli] Completed successfully.');
          providerInfo.executionDebug = [...localDebug];
        }
        const result = {
          kv: mergedKv,
          selectedKv,
          providerInfo,
        };
        if (cacheKey) {
          ocrResultCache.set(cacheKey, { expiresAt: Date.now() + OCR_CACHE_TTL_MS, value: cloneOcrResult(result) });
        }
        return result;
      }
    }

    const message = deriveOcrErrorMessage(stdout, stderr);
    const combinedMessage = buildErrorMessage(message);
    console.warn('[ocrService] structured.json missing or invalid. stderr:\n' + (stderr || '(empty)'));
    if (usingLocalMode) {
      localDebug.push('[local-cli] structured.json missing or invalid.');
      providerInfo.executionDebug = [...localDebug];
    }
    return { kv: {}, selectedKv: {}, providerInfo, error: combinedMessage };
  } catch (err) {
    if (timer) { clearTimeout(timer); }
    console.warn('[ocrService] Error running OCR script:', err);
    const message = err instanceof Error && err.message ? err.message : 'Failed to run OCR script.';
    const combinedMessage = buildErrorMessage(message);
    if (usingLocalMode) {
      const errMessage = err instanceof Error && err.message ? err.message : String(err);
      localDebug.push(`[local-cli] Exception: ${errMessage}`);
      providerInfo.executionDebug = [...localDebug];
    }
    return { kv: {}, selectedKv: {}, providerInfo, error: combinedMessage };
  } finally {
    if (!KEEP_TMP) rmrf(outDir);
    else console.log('[ocrService] Keeping temp OCR output at:', outDir);
  }
}

export function stubFromFilename(filePath: string): Record<string, string> {
  const basename = path.basename(filePath).toLowerCase();
  const code = basename.replace(/[^a-z0-9]+/g, '').slice(0, 6) || randomUUID().slice(0, 6);
  return {
    item_code: code.toUpperCase(),
    customer: 'Unknown Customer',
    order_date: new Date().toISOString().slice(0, 10),
  };
}
