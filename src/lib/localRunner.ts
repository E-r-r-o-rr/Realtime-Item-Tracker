import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

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

const statusMessages: Record<Exclude<LocalRunnerStatus, 'error'>, string> = {
  stopped: 'Local transformers runner is idle.',
  starting: 'Loading local transformers model…',
  running: 'Local transformers model is ready.',
  stopping: 'Unloading local transformers model…',
};

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

function buildWarmupEnv(modelId: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  env.VLM_MODE = 'local';
  env.LOCAL_VLM_MODEL = modelId;

  const settings = loadPersistedVlmSettings();
  const defaults = settings?.remote?.defaults;
  if (defaults && typeof defaults.maxOutputTokens === 'number' && defaults.maxOutputTokens > 0) {
    env.LOCAL_VLM_MAX_NEW_TOKENS = String(defaults.maxOutputTokens);
  }

  return env;
}

function runWarmup(modelId: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(OCR_SCRIPT)) {
      reject(new Error('OCR script not found. Ensure scripts/ocr_extract.py exists.'));
      return;
    }

    const args = [OCR_SCRIPT, '--model', modelId, '--warmup_only'];
    const env = buildWarmupEnv(modelId);
    const child = spawn(PY_BIN, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

export const getLocalRunnerState = (): LocalRunnerState => cloneState(currentState);

export const startLocalRunner = async (modelId: string | null | undefined): Promise<LocalRunnerState> => {
  const trimmed = (modelId || '').trim();
  if (!trimmed) {
    throw new Error('Model ID is required to start the local transformers runner.');
  }

  if (currentState.status === 'running' && currentState.modelId === trimmed) {
    return cloneState(currentState);
  }

  if (startPromise) {
    return startPromise;
  }

  updateState({ status: 'starting', modelId: trimmed, message: `Loading local model ${trimmed}…`, pid: null });

  const warmupPromise = runWarmup(trimmed)
    .then(({ stdout, stderr, code }) => {
      if (code !== 0) {
        const message = stderr.trim() || stdout.trim() || `Warmup failed with exit code ${code}`;
        return updateState({ status: 'error', modelId: trimmed, message, error: message, pid: null });
      }

      const message = `Local transformers model ${trimmed} loaded.`;
      return updateState({ status: 'running', modelId: trimmed, message, pid: null });
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Failed to warm up local transformers model.';
      return updateState({ status: 'error', modelId: trimmed, message, error: message, pid: null });
    });

  startPromise = warmupPromise;
  warmupPromise.finally(() => {
    if (startPromise === warmupPromise) {
      startPromise = null;
    }
  });

  return warmupPromise;
};

export const stopLocalRunner = async (): Promise<LocalRunnerState> => {
  if (startPromise) {
    try {
      await startPromise;
    } catch {
      // ignore warmup failure when stopping
    }
  }

  updateState({ status: 'stopping', pid: null });
  return updateState({ status: 'stopped', modelId: null, pid: null });
};

export const getLocalRunnerBaseUrl = (): string => 'local-transformers';
