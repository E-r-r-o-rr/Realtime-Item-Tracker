import fs from 'fs';
import path from 'path';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { randomUUID } from 'crypto';

import { DEFAULT_VLM_SETTINGS } from '@/config/vlm';
import { loadPersistedVlmSettings } from './settingsStore';

export type LocalRunnerStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface LocalRunnerState {
  status: LocalRunnerStatus;
  modelId: string | null;
  message: string;
  error: string | null;
  updatedAt: number;
  pid: number | null;
}

export interface LocalInferenceRequest {
  imagePath: string;
  normalizeDates?: boolean;
  ocrHint?: string | null;
  defaults?: Record<string, unknown>;
  systemPrompt?: string | null;
}

export interface LocalInferenceResult {
  ok: boolean;
  result?: {
    image: string;
    llm_raw: string;
    llm_parsed: Record<string, string>;
  };
  error?: string;
}

const statusMessages: Record<Exclude<LocalRunnerStatus, 'error'>, string> = {
  stopped: 'Local transformers runner is idle.',
  starting: 'Loading local transformers model…',
  running: 'Local transformers model is ready.',
  stopping: 'Unloading local transformers model…',
};

const MAX_LOG_LINES = 50;
const DEFAULT_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS || 180_000);

const PY_BIN =
  process.env.LOCAL_VLM_PYTHON ||
  process.env.OCR_PYTHON ||
  process.env.PYTHON_BIN ||
  (process.platform === 'win32' ? 'python' : 'python3');

const OCR_SCRIPT = path.join(process.cwd(), 'scripts', 'ocr_extract.py');

const cloneState = (state: LocalRunnerState): LocalRunnerState => ({ ...state });

let currentState: LocalRunnerState = {
  status: 'stopped',
  modelId: DEFAULT_VLM_SETTINGS.local.modelId,
  message: statusMessages.stopped,
  error: null,
  updatedAt: Date.now(),
  pid: null,
};

let startPromise: Promise<LocalRunnerState> | null = null;
let startPromiseResolver: ((state: LocalRunnerState) => void) | null = null;

let serverProcess: ChildProcessWithoutNullStreams | null = null;
let serverModelId: string | null = null;
let stdoutBuffer = '';

const pendingRequests = new Map<
  string,
  {
    resolve: (value: LocalInferenceResult) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout | null;
  }
>();

const recentLogs: string[] = [];

function appendLog(line: string) {
  if (!line) return;
  recentLogs.push(line);
  if (recentLogs.length > MAX_LOG_LINES) {
    recentLogs.splice(0, recentLogs.length - MAX_LOG_LINES);
  }
}

function settleStart(state: LocalRunnerState) {
  if (startPromise && startPromiseResolver) {
    startPromiseResolver(cloneState(state));
    startPromiseResolver = null;
    startPromise = null;
  }
}

function updateState(next: Partial<LocalRunnerState>): LocalRunnerState {
  const merged: LocalRunnerState = {
    ...currentState,
    ...next,
    updatedAt: Date.now(),
  };

  if (merged.status !== 'error') {
    merged.message = next.message || statusMessages[merged.status as Exclude<LocalRunnerStatus, 'error'>];
    merged.error = null;
  } else if (!next.error && !next.message) {
    merged.message = 'Local transformers runner encountered an error.';
    merged.error = merged.message;
  }

  currentState = merged;
  return cloneState(currentState);
}

function ensureScriptExists() {
  if (!fs.existsSync(OCR_SCRIPT)) {
    throw new Error('OCR script not found. Ensure scripts/ocr_extract.py exists.');
  }
}

function buildServerEnv(modelId: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  env.PYTHONUNBUFFERED = '1';
  env.VLM_MODE = 'local';
  env.LOCAL_VLM_MODEL = modelId;

  const settings = loadPersistedVlmSettings();
  const defaults = settings?.remote?.defaults;
  if (defaults && typeof defaults.maxOutputTokens === 'number' && defaults.maxOutputTokens > 0) {
    env.LOCAL_VLM_MAX_NEW_TOKENS = String(defaults.maxOutputTokens);
  } else {
    delete env.LOCAL_VLM_MAX_NEW_TOKENS;
  }

  const remoteConfig: Record<string, unknown> = {
    providerType: 'local-transformers',
    modelId,
  };
  if (defaults) {
    remoteConfig.defaults = defaults;
  }
  if (settings?.remote?.ocr) {
    remoteConfig.ocr = settings.remote.ocr;
  }

  try {
    env.VLM_REMOTE_CONFIG = JSON.stringify(remoteConfig);
  } catch {
    delete env.VLM_REMOTE_CONFIG;
  }

  const systemPrompt = defaults?.systemPrompt;
  if (typeof systemPrompt === 'string' && systemPrompt.trim()) {
    env.OCR_SYSTEM_PROMPT = systemPrompt;
  } else {
    delete env.OCR_SYSTEM_PROMPT;
  }

  return env;
}

function cleanupChildProcess() {
  serverProcess = null;
  serverModelId = null;
  stdoutBuffer = '';
}

function rejectAllPending(reason: string) {
  for (const [id, pending] of pendingRequests) {
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    pendingRequests.delete(id);
    pending.reject(new Error(reason));
  }
}

function handleServerMessage(message: any) {
  if (!message || typeof message !== 'object') {
    return;
  }

  const event = typeof message.event === 'string' ? message.event : '';
  if (event) {
    if (event === 'ready') {
      const state = updateState({
        status: 'running',
        message: `Local transformers model ${serverModelId ?? ''} loaded.`,
        pid: serverProcess?.pid ?? null,
      });
      settleStart(state);
    } else if (event === 'error') {
      const errorMessage = typeof message.error === 'string' ? message.error : 'Local transformers runner error.';
      appendLog(errorMessage);
      const state = updateState({ status: 'error', error: errorMessage, message: errorMessage, pid: null });
      settleStart(state);
    } else if (event === 'stopped') {
      updateState({ status: 'stopped', modelId: null, pid: null, message: 'Local transformers runner stopped.' });
    } else if (event === 'starting') {
      appendLog('Local transformers runner is warming up.');
    }
  }

  const reqId = typeof message.id === 'string' ? message.id : '';
  if (reqId && pendingRequests.has(reqId)) {
    const pending = pendingRequests.get(reqId)!;
    pendingRequests.delete(reqId);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }

    const ok = Boolean(message.ok);
    const result: LocalInferenceResult = { ok };
    if (ok && message.result) {
      result.result = message.result as LocalInferenceResult['result'];
    }
    if (!ok) {
      const errorMessage = typeof message.error === 'string' ? message.error : 'Local transformers inference failed.';
      result.error = errorMessage;
    }

    pending.resolve(result);
  } else if (typeof message.message === 'string') {
    appendLog(message.message);
  }
}

function handleStdoutData(chunk: string) {
  stdoutBuffer += chunk;
  let idx = stdoutBuffer.indexOf('\n');
  while (idx >= 0) {
    const line = stdoutBuffer.slice(0, idx).trim();
    stdoutBuffer = stdoutBuffer.slice(idx + 1);
    if (line) {
      try {
        const parsed = JSON.parse(line);
        handleServerMessage(parsed);
      } catch {
        appendLog(line);
      }
    }
    idx = stdoutBuffer.indexOf('\n');
  }
}

function spawnServer(modelId: string) {
  ensureScriptExists();

  const env = buildServerEnv(modelId);
  const args = [OCR_SCRIPT, '--model', modelId, '--stdio_server'];
  const child = spawn(PY_BIN, args, { env, stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;
  child.stdin.setDefaultEncoding('utf8');
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  serverProcess = child;
  serverModelId = modelId;
  stdoutBuffer = '';
  recentLogs.length = 0;

  updateState({ pid: child.pid ?? null });

  child.stdout.on('data', (data) => handleStdoutData(data.toString()));
  child.stderr.on('data', (data) => {
    const text = data.toString();
    appendLog(text.trim());
  });
  child.on('error', (error) => {
    appendLog(error.message);
    const state = updateState({ status: 'error', message: error.message, error: error.message, pid: null });
    settleStart(state);
    rejectAllPending(error.message);
  });
  child.on('exit', (code, signal) => {
    const wasStopping = currentState.status === 'stopping';
    const successExit = wasStopping || code === 0;
    const logTail = recentLogs.length ? `\n${recentLogs.join('\n')}` : '';
    const message = successExit
      ? 'Local transformers runner stopped.'
      : `Local transformers runner exited unexpectedly (code ${code}${signal ? `, signal ${signal}` : ''}).${logTail}`;

    if (successExit) {
      updateState({ status: 'stopped', modelId: null, pid: null, message });
    } else {
      const state = updateState({ status: 'error', message, error: message, pid: null });
      settleStart(state);
    }

    rejectAllPending(message);
    cleanupChildProcess();
  });
}

function sendShutdown(): Promise<void> {
  return new Promise((resolve) => {
    const child = serverProcess;
    if (!child) {
      resolve();
      return;
    }

    const onExit = () => {
      child.removeListener('exit', onExit);
      resolve();
    };

    child.once('exit', onExit);

    try {
      child.stdin.write(JSON.stringify({ action: 'shutdown' }) + '\n');
      child.stdin.end();
    } catch {
      try {
        child.kill();
      } catch {}
    }

    setTimeout(() => {
      try {
        child.kill();
      } catch {}
    }, 5000);
  });
}

export const getLocalRunnerState = (): LocalRunnerState => cloneState(currentState);

export const startLocalRunner = async (modelId: string | null | undefined): Promise<LocalRunnerState> => {
  const trimmed = (modelId || '').trim();
  if (!trimmed) {
    throw new Error('Model ID is required to start the local transformers runner.');
  }

  if (currentState.status === 'running' && currentState.modelId === trimmed && serverProcess) {
    return cloneState(currentState);
  }

  if (serverProcess && serverModelId && serverModelId !== trimmed) {
    await stopLocalRunner();
  }

  if (startPromise) {
    return startPromise;
  }

  updateState({ status: 'starting', modelId: trimmed, message: `Loading local model ${trimmed}…`, pid: null });

  startPromise = new Promise<LocalRunnerState>((resolve) => {
    startPromiseResolver = resolve;
  });

  try {
    spawnServer(trimmed);
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to launch local transformers runner.';
    const state = updateState({ status: 'error', message, error: message, pid: null });
    settleStart(state);
  }

  return startPromise;
};

export const stopLocalRunner = async (): Promise<LocalRunnerState> => {
  if (startPromise) {
    try {
      await startPromise;
    } catch {
      // ignore start failures when stopping
    }
  }

  if (!serverProcess) {
    updateState({ status: 'stopped', modelId: null, pid: null });
    return cloneState(currentState);
  }

  updateState({ status: 'stopping' });

  await sendShutdown();

  cleanupChildProcess();
  const state = updateState({ status: 'stopped', modelId: null, pid: null });
  return state;
};

export const runLocalInference = async (
  request: LocalInferenceRequest,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<LocalInferenceResult> => {
  if (!serverProcess || currentState.status !== 'running') {
    throw new Error('Local transformers runner is not ready.');
  }

  const id = randomUUID();
  const payload = {
    id,
    action: 'infer',
    image: request.imagePath,
    normalize_dates: request.normalizeDates !== false,
    ocr_hint: request.ocrHint ?? null,
    defaults: request.defaults ?? {},
    system_prompt: request.systemPrompt ?? null,
  };

  return new Promise<LocalInferenceResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('Local transformers inference timed out.'));
    }, timeoutMs);

    pendingRequests.set(id, {
      resolve: (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
      timeout,
    });

    try {
      serverProcess.stdin.write(JSON.stringify(payload) + '\n');
    } catch (error) {
      pendingRequests.delete(id);
      clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error('Failed to communicate with local transformers runner.'));
    }
  });
};

export const getLocalRunnerBaseUrl = (): string => 'local-transformers';
