import { spawn, type ChildProcessByStdio } from "child_process";
import fs from "fs";
import path from "path";
import type { Readable } from "stream";

import { DEFAULT_VLM_SETTINGS } from "@/config/vlm";
import { VlmLocalSettings } from "@/types/vlm";

const PY_BIN =
  process.env.OCR_PYTHON ||
  process.env.PYTHON_BIN ||
  (process.platform === "win32" ? "python" : "python3");

const SERVICE_SCRIPT = path.join(process.cwd(), "scripts", "ocr_local_service.py");
const DEFAULT_HOST = process.env.OCR_LOCAL_SERVICE_HOST || "127.0.0.1";
const DEFAULT_PORT = Number(process.env.OCR_LOCAL_SERVICE_PORT || 5117);
const READY_TIMEOUT_MS = Number(process.env.OCR_LOCAL_SERVICE_READY_TIMEOUT_MS || 120_000);
const STOP_TIMEOUT_MS = Number(process.env.OCR_LOCAL_SERVICE_STOP_TIMEOUT_MS || 10_000);
const HEALTH_PATH = process.env.OCR_LOCAL_SERVICE_HEALTH_PATH || "/health";
const INFER_PATH = process.env.OCR_LOCAL_SERVICE_INFER_PATH || "/infer";

export type LocalServiceConfig = {
  modelId: string;
  dtype: string;
  deviceMap: string;
  maxNewTokens: number;
  attnImpl: string;
  systemPrompt: string;
};

export type LocalServiceRuntime = {
  state: "stopped" | "starting" | "running";
  host: string;
  port: number;
  modelId?: string;
  startedAt?: number;
  config?: LocalServiceConfig;
  message?: string;
  logs?: { stdout: string[]; stderr: string[] };
  lastExit?: { code: number | null; signal: string | null; at: number };
};

type ServiceChildProcess = ChildProcessByStdio<null, Readable, Readable>;

type ServiceProcess = {
  child: ServiceChildProcess;
  host: string;
  port: number;
  modelId: string;
  startedAt: number;
  ready: boolean;
  config: LocalServiceConfig;
  stdout: string[];
  stderr: string[];
};

type LastExitSnapshot = {
  code: number | null;
  signal: string | null;
  at: number;
  message?: string;
  stdout: string[];
  stderr: string[];
  modelId?: string;
  host?: string;
  port?: number;
};

type LocalVlmServiceGlobalState = {
  current: ServiceProcess | null;
  exitHookInstalled: boolean;
  lastExit: LastExitSnapshot | null;
};

const GLOBAL_STATE_KEY = "__LOCAL_VLM_SERVICE_STATE__" as const;

type GlobalWithLocalState = typeof globalThis & {
  [GLOBAL_STATE_KEY]?: LocalVlmServiceGlobalState;
};

const globalTarget = globalThis as GlobalWithLocalState;
if (!globalTarget[GLOBAL_STATE_KEY]) {
  globalTarget[GLOBAL_STATE_KEY] = {
    current: null,
    exitHookInstalled: false,
    lastExit: null,
  };
}

const state = globalTarget[GLOBAL_STATE_KEY]!;

const MAX_LOG_LINES = 20;

function getCurrent(): ServiceProcess | null {
  return state.current;
}

function setCurrent(proc: ServiceProcess | null) {
  state.current = proc;
}

function recordExitSnapshot(
  proc: ServiceProcess,
  details: { code?: number | null; signal?: NodeJS.Signals | null; message?: string } = {},
) {
  const code = details.code ?? null;
  const signal = (details.signal as string | null | undefined) ?? null;
  const exitInfo: string[] = [];
  if (typeof code === "number") {
    exitInfo.push(`exit code ${code}`);
  }
  if (signal) {
    exitInfo.push(`signal ${signal}`);
  }

  const stderrTail = proc.stderr.length ? proc.stderr[proc.stderr.length - 1] : undefined;
  let message = details.message ?? "";
  if (!message) {
    const base = exitInfo.length ? `Service exited (${exitInfo.join(", ")}).` : "Service exited.";
    message = stderrTail ? `${base} Last stderr: ${stderrTail}` : base;
  } else if (stderrTail) {
    message = `${message} Last stderr: ${stderrTail}`;
  }

  state.lastExit = {
    code,
    signal,
    at: Date.now(),
    message,
    stdout: [...proc.stdout],
    stderr: [...proc.stderr],
    modelId: proc.modelId,
    host: proc.host,
    port: proc.port,
  };
}

function trimLog(buffer: string[], entry: string) {
  buffer.push(entry.trimEnd());
  if (buffer.length > MAX_LOG_LINES) {
    buffer.splice(0, buffer.length - MAX_LOG_LINES);
  }
}

function isAlive(proc: ServiceProcess | null): proc is ServiceProcess {
  return !!proc && proc.child.exitCode === null && !proc.child.killed;
}

function ensureExitHooks() {
  if (state.exitHookInstalled) return;
  state.exitHookInstalled = true;

  const shutdown = () => {
    const proc = getCurrent();
    if (proc && proc.child.exitCode === null && !proc.child.killed) {
      try {
        proc.child.kill();
      } catch {
        /* noop */
      }
    }
  };

  process.on("exit", shutdown);
}

function normalizeConfig(
  local: VlmLocalSettings,
  systemPrompt: string,
): LocalServiceConfig {
  return {
    modelId: local.modelId || DEFAULT_VLM_SETTINGS.local.modelId,
    dtype: local.dtype || "auto",
    deviceMap: local.deviceMap || "auto",
    maxNewTokens: local.maxNewTokens || DEFAULT_VLM_SETTINGS.local.maxNewTokens,
    attnImpl: local.enableFlashAttention2 ? "flash_attention_2" : "",
    systemPrompt: systemPrompt || "",
  };
}

export function getLocalVlmServiceStatus(): LocalServiceRuntime {
  const proc = getCurrent();
  if (!isAlive(proc)) {
    const snapshot = state.lastExit;
    const host = snapshot?.host ?? DEFAULT_HOST;
    const port = snapshot?.port ?? DEFAULT_PORT;
    return {
      state: "stopped",
      host,
      port,
      modelId: snapshot?.modelId,
      message: snapshot?.message,
      logs: snapshot
        ? {
            stdout: snapshot.stdout,
            stderr: snapshot.stderr,
          }
        : undefined,
      lastExit: snapshot
        ? {
            code: snapshot.code,
            signal: snapshot.signal,
            at: snapshot.at,
          }
        : undefined,
    };
  }
  return {
    state: proc.ready ? "running" : "starting",
    host: proc.host,
    port: proc.port,
    modelId: proc.modelId,
    startedAt: proc.startedAt,
    config: proc.config,
  };
}

async function waitForHealth(proc: ServiceProcess): Promise<{ startedAt?: number }> {
  const started = Date.now();
  const url = new URL(HEALTH_PATH, `http://${proc.host}:${proc.port}`);

  while (Date.now() - started < READY_TIMEOUT_MS) {
    if (!isAlive(proc)) {
      throw new Error("Local model service exited while starting");
    }

    try {
      const data = await fetch(url);
      if (data.ok) {
        const payload = (await data.json()) as { startedAt?: number };
        return payload ?? {};
      }
    } catch {
      // retry
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("Timed out waiting for local model service to become ready");
}

export async function startLocalVlmService(
  local: VlmLocalSettings,
  systemPrompt: string,
): Promise<LocalServiceRuntime> {
  ensureExitHooks();

  if (!fs.existsSync(SERVICE_SCRIPT)) {
    throw new Error("Local service script is missing. Reinstall the application dependencies.");
  }

  const host = DEFAULT_HOST;
  const existing = getCurrent();
  const port = existing?.port ?? DEFAULT_PORT;
  const config = normalizeConfig(local, systemPrompt);

  if (isAlive(existing)) {
    const sameConfig = JSON.stringify(existing.config) === JSON.stringify(config);
    if (sameConfig) {
      return getLocalVlmServiceStatus();
    }
    await stopLocalVlmService();
  }

  state.lastExit = null;

  const args = [
    SERVICE_SCRIPT,
    "--host",
    host,
    "--port",
    String(port),
    "--model",
    config.modelId,
    "--dtype",
    config.dtype,
    "--device-map",
    config.deviceMap,
    "--max-new-tokens",
    String(config.maxNewTokens),
  ];

  if (config.attnImpl) {
    args.push("--attn-impl", config.attnImpl);
  }
  if (config.systemPrompt) {
    args.push("--system-prompt", config.systemPrompt);
  }

  const env = { ...process.env };
  const child = spawn(PY_BIN, args, { env, stdio: ["ignore", "pipe", "pipe"] }) as ServiceChildProcess;

  const proc: ServiceProcess = {
    child,
    host,
    port,
    modelId: config.modelId,
    startedAt: Date.now(),
    ready: false,
    config,
    stdout: [],
    stderr: [],
  };
  setCurrent(proc);

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    trimLog(proc.stdout, text);
    process.stdout.write(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    trimLog(proc.stderr, text);
    process.stderr.write(text);
  });
  child.once("exit", (code, signal) => {
    if (getCurrent() === proc) {
      setCurrent(null);
    }
    recordExitSnapshot(proc, { code, signal });
  });
  child.once("error", (error) => {
    recordExitSnapshot(proc, {
      message: `Service process error: ${error instanceof Error ? error.message : String(error)}`,
    });
  });

  const health = await waitForHealth(proc);
  proc.ready = true;
  proc.startedAt =
    typeof health.startedAt === "number" ? Math.floor(health.startedAt * 1000) : Date.now();

  return getLocalVlmServiceStatus();
}

export async function stopLocalVlmService(): Promise<boolean> {
  const proc = getCurrent();
  if (!isAlive(proc)) {
    setCurrent(null);
    return false;
  }

  setCurrent(null);

  const exitPromise = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      try {
        proc.child.kill("SIGKILL");
      } catch {
        /* noop */
      }
      resolve(false);
    }, STOP_TIMEOUT_MS);

    proc.child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

  try {
    proc.child.kill();
  } catch {
    /* noop */
  }

  return exitPromise;
}

export type LocalServiceInferResult = {
  ok: boolean;
  result?: {
    image: string;
    llm_raw: string;
    llm_parsed: Record<string, unknown>;
  };
  durationMs?: number;
  source?: "local-service";
  message?: string;
};

export async function invokeLocalService(
  imagePath: string,
  options?: { signal?: AbortSignal; timeoutMs?: number; ocrHint?: string; normalizeDates?: boolean },
): Promise<LocalServiceInferResult> {
  const status = getLocalVlmServiceStatus();
  if (status.state !== "running") {
    const reason = status.message ? `: ${status.message}` : "";
    return { ok: false, message: `Local model service is not running${reason}` };
  }

  const host = status.host;
  const port = status.port;
  const url = new URL(INFER_PATH, `http://${host}:${port}`);

  const controller = new AbortController();
  const timeout = options?.timeoutMs ?? Number(process.env.OCR_LOCAL_SERVICE_TIMEOUT_MS || 120_000);
  const timer = setTimeout(() => controller.abort(), timeout);

  const signal = options?.signal;
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_path: imagePath,
        ocr_hint: options?.ocrHint ?? null,
        normalize_dates: options?.normalizeDates ?? true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      return { ok: false, message: payload?.message || `Local service error (${response.status})` };
    }

    const payload = (await response.json()) as LocalServiceInferResult;
    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reach local service";
    return { ok: false, message };
  } finally {
    clearTimeout(timer);
  }
}
