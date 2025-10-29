import { spawn, ChildProcess } from "child_process";

import { DEFAULT_VLM_SETTINGS } from "@/config/vlm";

export type LocalRunnerStatus = "stopped" | "starting" | "running" | "stopping" | "error";

export interface LocalRunnerState {
  status: LocalRunnerStatus;
  modelId: string | null;
  message: string;
  error: string | null;
  updatedAt: number;
  pid: number | null;
}

const VLLM_COMMAND = process.env.VLLM_BIN?.trim() || "vllm";
const VLLM_STOP_SIGNAL = (process.env.VLLM_STOP_SIGNAL?.trim() || "SIGTERM") as NodeJS.Signals;
const VLLM_STOP_GRACE_MS = Number(process.env.VLLM_STOP_GRACE_MS || 5000);
const VLLM_START_TIMEOUT_MS = Number(process.env.VLLM_START_TIMEOUT_MS || 60000);
const HEALTH_POLL_INTERVAL_MS = Number(process.env.VLLM_HEALTH_POLL_MS || 750);
const HEALTH_FETCH_TIMEOUT_MS = Number(process.env.VLLM_HEALTH_FETCH_TIMEOUT_MS || 5000);

const DEFAULT_HEALTH_PATHS = ["/health", "/v1/health"];
const MAX_RECENT_LOGS = 80;

const statusMessages: Record<Exclude<LocalRunnerStatus, "error">, string> = {
  stopped: "Local service is stopped.",
  starting: "Starting local service…",
  running: "Local service is running.",
  stopping: "Stopping local service…",
};

let childProcess: ChildProcess | null = null;
let shutdownHooksInstalled = false;
let startPromise: Promise<LocalRunnerState> | null = null;
let stopPromise: Promise<LocalRunnerState> | null = null;
let recentLogs: string[] = [];

const cloneState = (state: LocalRunnerState): LocalRunnerState => ({ ...state });

let currentState: LocalRunnerState = {
  status: "stopped",
  modelId: DEFAULT_VLM_SETTINGS.local.modelId,
  message: statusMessages.stopped,
  error: null,
  updatedAt: Date.now(),
  pid: null,
};

const pushRecentLog = (line: string) => {
  if (!line) {
    return;
  }
  recentLogs.push(line);
  if (recentLogs.length > MAX_RECENT_LOGS) {
    recentLogs.splice(0, recentLogs.length - MAX_RECENT_LOGS);
  }
};

const getRecentLogSnippet = (lines = 6): string => {
  if (recentLogs.length === 0) {
    return "";
  }
  const slice = recentLogs.slice(-Math.max(1, lines));
  return slice.join("\n");
};

const findRecentLogLine = (pattern: RegExp): string | null => {
  for (let i = recentLogs.length - 1; i >= 0; i -= 1) {
    const line = recentLogs[i];
    if (pattern.test(line)) {
      return line;
    }
  }
  return null;
};

const deriveKnownErrorMessage = (): string | null => {
  if (findRecentLogLine(/ModuleNotFoundError: No module named ['"]vllm\._C['"]/)) {
    return "Local vLLM failed to load its CUDA extension (module vllm._C). Install vLLM with GPU support (for example `pip install \"vllm[triton]\"`) and ensure the CUDA toolkit matches your GPU drivers.";
  }

  if (findRecentLogLine(/CUDA driver version is insufficient/)) {
    return "Local vLLM could not access the GPU because the CUDA driver version is insufficient. Update your NVIDIA drivers or install a CUDA toolkit compatible with the vLLM build.";
  }

  if (findRecentLogLine(/Permission denied/)) {
    return "Local vLLM process reported a permission error. Verify that the model cache directory is readable.";
  }

  return null;
};

const buildFailureMessage = (fallback: string): string => {
  const known = deriveKnownErrorMessage();
  if (known) {
    return known;
  }

  const snippet = getRecentLogSnippet();
  if (!snippet) {
    return fallback;
  }

  return `${fallback}\nRecent output:\n${snippet}`;
};

const updateState = (next: Partial<LocalRunnerState>): LocalRunnerState => {
  const merged: LocalRunnerState = {
    ...currentState,
    ...next,
    updatedAt: Date.now(),
  };

  if (merged.status !== "error") {
    merged.message = next.message || statusMessages[merged.status as Exclude<LocalRunnerStatus, "error">];
    merged.error = null;
  }

  currentState = merged;
  return cloneState(currentState);
};

const resetStateAfterExit = (code: number | null, signal: NodeJS.Signals | null) => {
  if (currentState.status === "error") {
    currentState = {
      ...currentState,
      modelId: null,
      pid: null,
      updatedAt: Date.now(),
    };
    return;
  }

  const exitInfo = code !== null ? `code ${code}` : signal ? `signal ${signal}` : "unknown status";
  const baseMessage = `Local VLM service exited (${exitInfo}).`;

  if (currentState.status === "stopping") {
    updateState({ status: "stopped", modelId: null, pid: null, message: "Local service stopped." });
    return;
  }

  if (code === 0 || signal === "SIGTERM") {
    updateState({ status: "stopped", modelId: null, pid: null, message: baseMessage });
    return;
  }

  const message = buildFailureMessage(baseMessage);
  updateState({
    status: "error",
    modelId: null,
    pid: null,
    message,
    error: message,
  });
};

const ensureShutdownHooks = () => {
  if (shutdownHooksInstalled) {
    return;
  }

  shutdownHooksInstalled = true;
  const terminateChild = (reason: string) => {
    if (childProcess) {
      try {
        console.warn(`[vllmRunner] Shutting down child due to ${reason}.`);
        childProcess.kill("SIGTERM");
      } catch (error) {
        console.error("[vllmRunner] Failed to terminate child process", error);
      }
    }
  };

  process.once("exit", () => terminateChild("process exit"));
  ["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) => {
    process.once(signal as NodeJS.Signals, () => {
      terminateChild(`signal ${signal}`);
      try {
        process.kill(process.pid, signal as NodeJS.Signals);
      } catch {}
    });
  });
};

const parseServeArgs = (): string[] => {
  const raw = process.env.VLLM_SERVE_ARGS;
  if (!raw) {
    return [];
  }

  const matches = raw.match(/(?:[^\s\"]+|\"[^\"]*\")+/g);
  if (!matches) {
    return [];
  }

  return matches.map((token) => token.replace(/^\"|\"$/g, ""));
};

const getConfiguredProtocol = () => (process.env.VLLM_PROTOCOL?.trim() || "http").replace(/:$/, "");

const getConfiguredHost = () => process.env.VLLM_HOST?.trim() || "127.0.0.1";

const getConfiguredPort = () => process.env.VLLM_PORT?.trim() || "8000";

export const getLocalRunnerOrigin = (): string => {
  const explicit = process.env.VLLM_BASE_URL?.trim();
  if (explicit) {
    try {
      const url = new URL(explicit);
      return url.origin;
    } catch (error) {
      console.warn("[vllmRunner] Failed to parse VLLM_BASE_URL, falling back to host/port", error);
    }
  }

  const protocol = getConfiguredProtocol();
  const host = getConfiguredHost();
  const port = getConfiguredPort();
  return port ? `${protocol}://${host}:${port}` : `${protocol}://${host}`;
};

export const getLocalRunnerBaseUrl = (): string => {
  const explicit = process.env.VLLM_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }
  const origin = getLocalRunnerOrigin();
  return `${origin.replace(/\/+$/, "")}/v1`;
};

const getHealthPaths = (): string[] => {
  const raw = process.env.VLLM_HEALTH_PATHS;
  if (!raw) {
    return DEFAULT_HEALTH_PATHS;
  }
  const tokens = raw
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens.length > 0 ? tokens : DEFAULT_HEALTH_PATHS;
};

const getHealthUrls = (): string[] => {
  const origin = getLocalRunnerOrigin().replace(/\/+$/, "");
  const baseUrl = getLocalRunnerBaseUrl().replace(/\/+$/, "");
  const urls = new Set<string>();

  getHealthPaths().forEach((path) => {
    if (!path) {
      return;
    }
    if (/^https?:\/\//i.test(path)) {
      urls.add(path);
      return;
    }
    if (path.startsWith("/v1")) {
      urls.add(`${origin}${path}`);
      return;
    }
    urls.add(`${origin}${path.startsWith("/") ? path : `/${path}`}`);
  });

  urls.add(`${baseUrl}/models`);

  return Array.from(urls);
};

const waitForServerReady = async (child: ChildProcess): Promise<void> => {
  const fetchImpl: typeof fetch | undefined =
    typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined;
  if (!fetchImpl) {
    console.warn("[vllmRunner] fetch is not available in this runtime; skipping readiness check.");
    return;
  }

  const deadline = Date.now() + VLLM_START_TIMEOUT_MS;
  const healthUrls = getHealthUrls();

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode) {
      throw new Error(buildFailureMessage("Local VLM service exited before becoming ready."));
    }

    for (const url of healthUrls) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HEALTH_FETCH_TIMEOUT_MS);
      try {
        const response = await fetchImpl(url, { method: "GET", signal: controller.signal });
        if (response.ok) {
          clearTimeout(timeout);
          return;
        }
      } catch {
        // swallow errors and retry
      } finally {
        clearTimeout(timeout);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
  }

  const seconds = Math.round(VLLM_START_TIMEOUT_MS / 1000);
  throw new Error(`Local VLM service did not become ready within ${seconds}s.`);
};

export const getLocalRunnerState = (): LocalRunnerState => cloneState(currentState);

export const markLocalRunnerError = (message: string): LocalRunnerState => {
  currentState = {
    ...currentState,
    status: "error",
    message,
    error: message,
    modelId: null,
    pid: null,
    updatedAt: Date.now(),
  };
  return cloneState(currentState);
};

const attachChildListeners = (child: ChildProcess) => {
  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => pushRecentLog(`[stdout] ${line}`));
    const printable = text.trimEnd();
    if (printable) {
      console.log(`[vllm:${child.pid}] ${printable}`);
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => pushRecentLog(`[stderr] ${line}`));
    const printable = text.trimEnd();
    if (printable) {
      console.error(`[vllm:${child.pid}] ${printable}`);
    }
  });

  child.once("exit", (code, signal) => {
    if (childProcess === child) {
      childProcess = null;
      resetStateAfterExit(code, signal);
    }
  });

  child.once("error", (error) => {
    if (childProcess === child) {
      childProcess = null;
      pushRecentLog(`[error] ${error.message}`);
      const message = buildFailureMessage(`Local VLM service error: ${error.message}`);
      console.error("[vllmRunner] Child process error", error);
      markLocalRunnerError(message);
    }
  });
};

export const startLocalRunner = async (modelId: string): Promise<LocalRunnerState> => {
  const trimmed = modelId?.trim();
  if (!trimmed) {
    throw new Error("Model ID is required to start the local VLM service.");
  }

  if (startPromise) {
    return startPromise;
  }

  if (currentState.status === "stopping") {
    if (stopPromise) {
      await stopPromise;
    } else {
      throw new Error("Local VLM service is stopping. Try again shortly.");
    }
  }

  if (currentState.status === "starting") {
    return getLocalRunnerState();
  }

  if (currentState.status === "running" && currentState.modelId === trimmed && childProcess) {
    return updateState({ message: `Local service already running (${trimmed}).`, pid: childProcess.pid ?? null });
  }

  const doStart = async (): Promise<LocalRunnerState> => {
    if (currentState.status === "running" && currentState.modelId !== trimmed) {
      await stopLocalRunner({ reason: "Switching model" });
    }

    ensureShutdownHooks();
    recentLogs = [];
    updateState({ status: "starting", modelId: trimmed, message: `Starting local service with ${trimmed}…`, pid: null });

    const args = ["serve", trimmed];
    const host = process.env.VLLM_HOST?.trim();
    const port = process.env.VLLM_PORT?.trim();
    if (host) {
      args.push("--host", host);
    }
    if (port) {
      args.push("--port", port);
    }
    args.push(...parseServeArgs());

    const child = spawn(VLLM_COMMAND, args, {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    childProcess = child;

    try {
      await new Promise<void>((resolve, reject) => {
        const handleError = (error: Error) => {
          child.off("spawn", handleSpawn);
          reject(error);
        };
        const handleSpawn = () => {
          child.off("error", handleError);
          resolve();
        };
        child.once("error", handleError);
        child.once("spawn", handleSpawn);
      });
    } catch (error) {
      childProcess = null;
      pushRecentLog(`[error] ${error instanceof Error ? error.message : String(error)}`);
      const message = buildFailureMessage(
        error instanceof Error ? error.message : "Failed to spawn local VLM service.",
      );
      markLocalRunnerError(message);
      throw new Error(message);
    }

    attachChildListeners(child);
    updateState({ message: `Waiting for local service to become ready (${trimmed})…`, pid: child.pid ?? null });

    try {
      await waitForServerReady(child);
    } catch (error) {
      const message = buildFailureMessage(
        error instanceof Error ? error.message : "Local VLM service failed to become ready.",
      );
      markLocalRunnerError(message);
      console.error("[vllmRunner] Local runner failed to become ready", error);
      try {
        if (child.exitCode === null && !child.killed) {
          child.kill("SIGTERM");
        }
      } catch (killError) {
        console.error("[vllmRunner] Failed to terminate child after readiness error", killError);
      }
      throw new Error(message);
    }

    return updateState({
      status: "running",
      modelId: trimmed,
      message: `Local service running with ${trimmed}.`,
      pid: child.pid ?? null,
    });
  };

  startPromise = doStart();
  try {
    return await startPromise;
  } finally {
    startPromise = null;
  }
};

type StopOptions = {
  reason?: string;
  force?: boolean;
  signal?: NodeJS.Signals;
};

export const stopLocalRunner = async (options: StopOptions = {}): Promise<LocalRunnerState> => {
  if (stopPromise) {
    return stopPromise;
  }

  const doStop = async (): Promise<LocalRunnerState> => {
    const existing = childProcess;
    if (!existing) {
      return updateState({ status: "stopped", modelId: null, message: "Local service already stopped.", pid: null });
    }

    const message = options.reason ? `Stopping local service (${options.reason})…` : statusMessages.stopping;
    updateState({ status: "stopping", message, pid: existing.pid ?? null });

    const signal = options.signal || VLLM_STOP_SIGNAL;
    const forceKill = options.force ?? true;

    const waitForExit = new Promise<LocalRunnerState>((resolve) => {
      const handleExit = () => {
        resolve(getLocalRunnerState());
      };
      existing.once("exit", handleExit);
      if (typeof existing.exitCode === "number" || existing.signalCode) {
        queueMicrotask(handleExit);
      }
    });

    try {
      const killed = existing.kill(signal);
      if (!killed && typeof existing.exitCode !== "number" && !existing.signalCode) {
        throw new Error(`Failed to send ${signal} to local VLM process.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to stop local VLM service.";
      console.error("[vllmRunner] Error stopping child", error);
      markLocalRunnerError(message);
      throw new Error(message);
    }

    if (forceKill) {
      setTimeout(() => {
        if (childProcess === existing) {
          try {
            existing.kill("SIGKILL");
          } catch (error) {
            console.error("[vllmRunner] Failed to SIGKILL child", error);
          }
        }
      }, VLLM_STOP_GRACE_MS);
    }

    return waitForExit;
  };

  stopPromise = doStop()
    .then((result) => {
      if (result.status !== "stopped") {
        return updateState({ status: "stopped", modelId: null, pid: null, message: "Local service stopped." });
      }
      return result;
    })
    .catch((error) => {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    });

  try {
    return await stopPromise;
  } finally {
    stopPromise = null;
  }
};

