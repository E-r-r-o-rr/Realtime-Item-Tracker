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

const cloneState = (state: LocalRunnerState): LocalRunnerState => ({ ...state });

let currentState: LocalRunnerState = {
  status: "stopped",
  modelId: DEFAULT_VLM_SETTINGS.local.modelId,
  message: statusMessages.stopped,
  error: null,
  updatedAt: Date.now(),
  pid: null,
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

  updateState({
    status: "error",
    modelId: null,
    pid: null,
    message: baseMessage,
    error: baseMessage,
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

  const matches = raw.match(/(?:[^\s"]+|"[^"]*")+/g);
  if (!matches) {
    return [];
  }

  return matches.map((token) => token.replace(/^"|"$/g, ""));
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
    const text = chunk.toString().trimEnd();
    if (text) {
      console.log(`[vllm:${child.pid}] ${text}`);
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trimEnd();
    if (text) {
      console.error(`[vllm:${child.pid}] ${text}`);
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
      const message = `Local VLM service error: ${error.message}`;
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
    } catch (error: any) {
      childProcess = null;
      const message = error instanceof Error ? error.message : "Failed to spawn local VLM service.";
      markLocalRunnerError(message);
      throw new Error(message);
    }

    attachChildListeners(child);
    return updateState({ status: "running", modelId: trimmed, message: `Local service running with ${trimmed}.`, pid: child.pid ?? null });
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
      const message =
        error instanceof Error ? error.message : "Failed to stop local VLM service.";
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
