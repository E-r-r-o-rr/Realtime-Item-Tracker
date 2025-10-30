import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

import { loadPersistedVlmSettings } from './settingsStore';
import { startLocalRunner, runLocalInference } from './localRunner';

export type VlmProviderInfo = {
  mode: 'remote' | 'local';
  providerType?: string;
  modelId?: string;
  baseUrl?: string;
};

export type OcrExtractionResult = {
  kv: Record<string, string>;
  providerInfo: VlmProviderInfo;
  error?: string;
};

const DEFAULT_MODEL = process.env.OCR_MODEL || 'Qwen/Qwen3-VL-2B-Instruct';

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

function resolveOcrHint(settings: ReturnType<typeof loadPersistedVlmSettings>): string | undefined {
  const envHint = process.env.OCR_HINT_TEXT;
  if (typeof envHint === 'string' && envHint.trim()) {
    return envHint.trim();
  }

  const ocrSettings = settings.remote?.ocr;
  if (ocrSettings) {
    const transcript = typeof ocrSettings.prefillTranscript === 'string' ? ocrSettings.prefillTranscript.trim() : '';
    if (transcript) {
      return transcript;
    }
    const hint = typeof ocrSettings.ocrHint === 'string' ? ocrSettings.ocrHint.trim() : '';
    if (hint) {
      return hint;
    }
  }

  return undefined;
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
  const localModelId = vlmSettings.local?.modelId?.trim();
  const configuredModel =
    vlmSettings.mode === 'remote'
      ? vlmSettings.remote.modelId?.trim() || localModelId || DEFAULT_MODEL
      : localModelId || DEFAULT_MODEL;

  const providerInfo: VlmProviderInfo = {
    mode: vlmSettings.mode,
  };

  const remoteConfigBase: any = JSON.parse(JSON.stringify(vlmSettings.remote || {}));
  let remoteConfigPayload: any = null;
  let localProviderId = '';

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
    remoteConfigPayload = remoteConfigBase;
  } else {
    providerInfo.providerType = 'local-transformers';
    providerInfo.modelId = configuredModel;
    providerInfo.baseUrl = 'local-transformers';
    remoteConfigPayload = {
      providerType: 'local-transformers',
      modelId: configuredModel,
      defaults: remoteConfigBase?.defaults || vlmSettings.remote?.defaults || {},
    };
    localProviderId = 'local-transformers';
  }

  if (!fs.existsSync(OCR_SCRIPT)) {
    console.warn('[ocrService] Python script not found, returning stub.');
    return { kv: stubFromFilename(filePath), providerInfo };
  }

  const ocrHint = resolveOcrHint(vlmSettings);

  const defaultsSource = (remoteConfigPayload?.defaults ?? vlmSettings.remote?.defaults ?? {}) as Record<string, unknown>;
  const rawSystemPrompt = defaultsSource['systemPrompt'];
  const systemPrompt = typeof rawSystemPrompt === 'string' && rawSystemPrompt.trim() ? rawSystemPrompt.trim() : undefined;
  const generationDefaults: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(defaultsSource || {})) {
    if (key === 'systemPrompt') continue;
    if (value === undefined || typeof value === 'function') continue;
    generationDefaults[key] = value;
  }

  if (vlmSettings.mode === 'local') {
    try {
      const runnerState = await startLocalRunner(configuredModel);
      if (runnerState.status !== 'running') {
        const message = runnerState.error || runnerState.message || 'Local VLM runner is not ready.';
        return { kv: {}, providerInfo, error: message };
      }

      const inference = await runLocalInference({
        imagePath: filePath,
        normalizeDates: true,
        ocrHint,
        defaults: generationDefaults,
        systemPrompt,
      });

      if (!inference.ok || !inference.result?.llm_parsed) {
        const message = inference.error || 'Local transformers inference failed.';
        return { kv: {}, providerInfo, error: message };
      }

      return { kv: inference.result.llm_parsed, providerInfo };
    } catch (error: any) {
      const message = error instanceof Error ? error.message : 'Local transformers runner failed.';
      console.error('[ocrService] Local inference error', error);
      return { kv: {}, providerInfo, error: message };
    }
  }

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-out-'));

  const args = [
    OCR_SCRIPT,
    '--image', filePath,
    '--out_dir', outDir,
    '--model', configuredModel,
  ];

  const env = { ...process.env };
  env.VLM_MODE = vlmSettings.mode;
  if (remoteConfigPayload) {
    env.VLM_REMOTE_CONFIG = JSON.stringify(remoteConfigPayload);
    const timeoutCandidate = remoteConfigPayload.requestTimeoutMs;
    const fallbackTimeout = vlmSettings.remote.requestTimeoutMs || OCR_TIMEOUT_MS;
    const effectiveTimeout = typeof timeoutCandidate === 'number' && timeoutCandidate > 0 ? timeoutCandidate : fallbackTimeout;
    env.OCR_REQUEST_TIMEOUT_MS = String(effectiveTimeout);

    const retryCandidate = remoteConfigPayload.retryPolicy?.maxRetries;
    const fallbackRetry = vlmSettings.remote.retryPolicy?.maxRetries ?? 0;
    env.OCR_RETRY_MAX = String(typeof retryCandidate === 'number' ? retryCandidate : fallbackRetry);

    const streamingFlag = generationDefaults['streaming'];
    env.OCR_STREAMING = streamingFlag ? '1' : '0';
  } else {
    delete env.VLM_REMOTE_CONFIG;
    delete env.OCR_REQUEST_TIMEOUT_MS;
    delete env.OCR_RETRY_MAX;
    delete env.OCR_STREAMING;
  }

  if (systemPrompt) {
    env.OCR_SYSTEM_PROMPT = systemPrompt;
  } else {
    delete env.OCR_SYSTEM_PROMPT;
  }

  if (ocrHint) {
    env.OCR_HINT_TEXT = ocrHint;
  } else {
    delete env.OCR_HINT_TEXT;
  }

  if (vlmSettings.mode === 'remote') {
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
    delete env.HF_TOKEN;
    env.LOCAL_VLM_MODEL = configuredModel;
    if (localProviderId) {
      env.VLM_LOCAL_PROVIDER = localProviderId;
    } else {
      delete env.VLM_LOCAL_PROVIDER;
    }
    const maxTokens = generationDefaults['maxOutputTokens'];
    if (typeof maxTokens === 'number' && maxTokens > 0) {
      env.LOCAL_VLM_MAX_NEW_TOKENS = String(maxTokens);
    } else {
      delete env.LOCAL_VLM_MAX_NEW_TOKENS;
    }
  }

  if (vlmSettings.mode === 'remote') {
    delete env.LOCAL_VLM_MODEL;
    delete env.LOCAL_VLM_MAX_NEW_TOKENS;
    delete env.VLM_LOCAL_PROVIDER;
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
      return { kv: {}, providerInfo, error: message };
    }

    const structuredPath = path.join(outDir, 'structured.json');
    if (fs.existsSync(structuredPath)) {
      const payload = JSON.parse(fs.readFileSync(structuredPath, 'utf-8'));
      // Python writes an array with a single record: { image, llm_raw, llm_parsed }
      if (Array.isArray(payload) && payload.length > 0 && payload[0]?.llm_parsed) {
        return {
          kv: payload[0].llm_parsed as Record<string, string>,
          providerInfo,
        };
      }
    }

    const message = deriveOcrErrorMessage(stdout, stderr);
    console.warn('[ocrService] structured.json missing or invalid. stderr:\n' + (stderr || '(empty)'));
    return { kv: {}, providerInfo, error: message };
  } catch (err) {
    if (timer) { clearTimeout(timer); }
    console.warn('[ocrService] Error running OCR script:', err);
    const message = err instanceof Error && err.message ? err.message : 'Failed to run OCR script.';
    return { kv: {}, providerInfo, error: message };
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
