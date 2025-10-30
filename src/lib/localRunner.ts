import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import fs from "fs";
import path from "path";

import { DEFAULT_VLM_SETTINGS } from "@/config/vlm";

export type LocalRunnerStatus = "stopped" | "checking" | "starting" | "running" | "stopping" | "error";

export interface LocalRunnerState {
  status: LocalRunnerStatus;
  modelId: string | null;
  message: string;
  error: string | null;
  updatedAt: number;
  installed: boolean | null;
}

const statusMessages: Record<Exclude<LocalRunnerStatus, "error">, string> = {
  stopped: "Local service is stopped.",
  checking: "Checking local model files…",
  starting: "Starting local service…",
  running: "Local service is running.",
  stopping: "Stopping local service…",
};

const cloneState = (state: LocalRunnerState): LocalRunnerState => structuredClone(state);

const applyDefaults = (state: LocalRunnerState): LocalRunnerState => {
  if (state.status === "error") {
    return state;
  }
  return {
    ...state,
    message: state.message || statusMessages[state.status],
    error: null,
    installed: state.installed ?? currentState.installed ?? null,
  };
};

const PY_BIN =
  process.env.LOCAL_VLM_PYTHON ||
  process.env.OCR_PYTHON ||
  process.env.PYTHON_BIN ||
  (process.platform === "win32" ? "python" : "python3");

const RUNNER_SCRIPT = path.join(process.cwd(), "scripts", "local_vlm_runner.py");

const INSTALL_GUIDE = (modelId: string): string =>
  `Model "${modelId}" is not installed locally. Install the weights with: pip install -U "transformers accelerate huggingface_hub" && huggingface-cli download "${modelId}". Afterwards press “Start local service” again.`;

let runnerProcess: ChildProcessWithoutNullStreams | null = null;
let runnerModelId: string | null = null;
let runnerStopping = false;

const resetRunnerRefs = () => {
  runnerProcess = null;
  runnerModelId = null;
  runnerStopping = false;
};

let currentState: LocalRunnerState = {
  status: "stopped",
  modelId: DEFAULT_VLM_SETTINGS.local.modelId,
  message: statusMessages.stopped,
  error: null,
  updatedAt: Date.now(),
  installed: null,
};

const updateState = (next: Partial<LocalRunnerState>): LocalRunnerState => {
  currentState = applyDefaults({
    ...currentState,
    ...next,
    updatedAt: Date.now(),
  });
  return cloneState(currentState);
};

export const getLocalRunnerState = (): LocalRunnerState => cloneState(currentState);

const parseRunnerEvent = (line: string): Record<string, unknown> | null => {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  // Some libraries (e.g. huggingface_hub) emit progress updates to stdout using
  // carriage returns. When that happens the JSON payload from the Python runner
  // may be appended to an existing progress message. Attempt to recover by
  // slicing out the JSON object from the last opening/closing braces.
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
    const candidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      // fall through to debug log below
    }
  }

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    console.debug("[localRunner]", trimmed);
    return null;
  }
};

const setErrorState = (
  message: string,
  modelId: string | null = null,
  installed: boolean | null = currentState.installed ?? null,
) => updateState({ status: "error", message, error: message, modelId, installed });

const ensureRunnerScript = () => {
  if (!fs.existsSync(RUNNER_SCRIPT)) {
    throw new Error(
      `Local runner script not found at ${RUNNER_SCRIPT}. Ensure the repository scripts are intact.`,
    );
  }
};

type RunnerResult = { stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null };

const runRunnerCommand = (args: string[]): Promise<RunnerResult> =>
  new Promise((resolve, reject) => {
    ensureRunnerScript();
    const child = spawn(PY_BIN, [RUNNER_SCRIPT, ...args], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ stdout, stderr, code, signal });
    });
  });

const ensureModelInstalled = async (modelId: string) => {
  const { stdout, stderr, code } = await runRunnerCommand(["--model", modelId, "--check-only"]);
  if (code === 0) {
    return;
  }

  let detail = "";
  const combined = `${stdout}\n${stderr}`.split(/\r?\n/);
  for (const line of combined) {
    const payload = parseRunnerEvent(line);
    if (payload?.error && typeof payload.error === "string") {
      detail = payload.error;
    }
  }

  const guide = INSTALL_GUIDE(modelId);
  const message = detail ? `${detail} ${guide}` : guide;
  throw new Error(message.trim());
};

export const checkLocalModelAvailability = async (modelId: string): Promise<LocalRunnerState> => {
  const trimmed = modelId?.trim();
  if (!trimmed) {
    throw new Error("Model ID is required to check local availability.");
  }

  updateState({
    status: "checking",
    modelId: trimmed,
    message: `Checking local files for ${trimmed}…`,
    installed: null,
  });

  try {
    await ensureModelInstalled(trimmed);
  } catch (error: any) {
    const message = error instanceof Error ? error.message : INSTALL_GUIDE(trimmed);
    updateState({
      status: "error",
      modelId: trimmed,
      message,
      error: message,
      installed: false,
    });
    throw new Error(message);
  }

  return updateState({
    status: "stopped",
    modelId: trimmed,
    message: `Model \"${trimmed}\" is available locally.`,
    installed: true,
  });
};

const attachRunnerListeners = (child: ChildProcessWithoutNullStreams, modelId: string) => {
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
      const event = parseRunnerEvent(line);
      if (!event) continue;
      const type = typeof event.event === "string" ? (event.event as string) : "";
      const message = typeof event.message === "string" ? (event.message as string) : undefined;
      const error = typeof event.error === "string" ? (event.error as string) : undefined;

      switch (type) {
        case "loading":
          updateState({
            status: "starting",
            modelId,
            message: message || `Loading ${modelId} locally…`,
            installed: true,
          });
          break;
        case "ready":
          updateState({
            status: "running",
            modelId,
            message: message || `Local service running with ${modelId}.`,
            installed: true,
          });
          break;
        case "fatal":
          setErrorState(error || `Failed to start local model ${modelId}.`, modelId, false);
          if (!runnerStopping && runnerProcess) {
            try {
              runnerProcess.kill();
            } catch {}
          }
          break;
        case "missing":
          setErrorState(error ? `${error} ${INSTALL_GUIDE(modelId)}` : INSTALL_GUIDE(modelId), modelId, false);
          if (runnerProcess) {
            try {
              runnerProcess.kill();
            } catch {}
          }
          break;
        case "shutdown":
          if (!runnerStopping) {
            updateState({
              status: "stopping",
              modelId,
              message: "Local runner shutting down…",
              installed: currentState.installed,
            });
          }
          break;
        case "stopped":
          if (runnerStopping) {
            updateState({
              status: "stopped",
              modelId: null,
              message: message || "Local service stopped.",
              installed: currentState.installed,
            });
          } else {
            setErrorState(message || "Local runner exited unexpectedly.", modelId);
          }
          break;
        default:
          break;
      }
    }
  });

  child.stdout.on("close", () => {
    if (buffer.trim().length > 0) {
      const event = parseRunnerEvent(buffer);
      if (event && typeof event.message === "string") {
        console.debug("[localRunner]", event.message);
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      console.warn(`[localRunner] stderr: ${text}`);
    }
  });

  child.on("exit", (code, signal) => {
    if (runnerStopping) {
      updateState({
        status: "stopped",
        modelId: null,
        message: "Local service stopped.",
        installed: currentState.installed,
      });
    } else if (code !== 0) {
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      setErrorState(`Local runner exited (${reason}).`, modelId);
    } else {
      updateState({
        status: "stopped",
        modelId: null,
        message: "Local service stopped.",
        installed: currentState.installed,
      });
    }
    resetRunnerRefs();
  });
};

process.once("exit", () => {
  if (runnerProcess) {
    try {
      runnerProcess.kill();
    } catch {}
  }
});

export const startLocalRunner = async (modelId: string): Promise<LocalRunnerState> => {
  const trimmed = modelId?.trim();
  if (!trimmed) {
    throw new Error("Model ID is required to start the local VLM service.");
  }

  if (runnerProcess && currentState.status === "running" && runnerModelId === trimmed) {
    return updateState({ message: `Local service already running (${trimmed}).` });
  }

  if (currentState.status === "starting") {
    return updateState({ message: currentState.message || `Local service is starting with ${trimmed}…` });
  }

  if (currentState.status === "stopping") {
    throw new Error("Local service is stopping. Wait for it to finish before starting again.");
  }

  if (runnerProcess) {
    await stopLocalRunner();
  }

  updateState({
    status: "checking",
    modelId: trimmed,
    message: `Checking local files for ${trimmed}…`,
    installed: currentState.installed,
  });

  try {
    await ensureModelInstalled(trimmed);
  } catch (error: any) {
    const message = error instanceof Error ? error.message : INSTALL_GUIDE(trimmed);
    setErrorState(message, trimmed, false);
    throw new Error(message);
  }

  updateState({
    status: "starting",
    modelId: trimmed,
    message: `Loading ${trimmed} locally…`,
    installed: true,
  });

  ensureRunnerScript();
  runnerStopping = false;
  runnerModelId = trimmed;
  const child = spawn(PY_BIN, [RUNNER_SCRIPT, "--model", trimmed], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;

  runnerProcess = child;

  attachRunnerListeners(child, trimmed);

  return getLocalRunnerState();
};

export const stopLocalRunner = async (): Promise<LocalRunnerState> => {
  if (currentState.status === "stopped") {
    return updateState({ message: "Local service already stopped.", modelId: null, installed: currentState.installed });
  }

  updateState({ status: "stopping", message: "Stopping local service…", installed: currentState.installed });

  if (runnerProcess) {
    runnerStopping = true;
    const child = runnerProcess;
    await new Promise<void>((resolve) => {
      const onExit = () => resolve();
      child.once("exit", onExit);
      try {
        child.kill();
      } catch {
        resolve();
      }
      setTimeout(() => resolve(), 5000).unref();
    });
  }

  resetRunnerRefs();
  return updateState({
    status: "stopped",
    modelId: null,
    message: "Local service stopped.",
    installed: currentState.installed,
  });
};

export const markLocalRunnerError = (message: string): LocalRunnerState => {
  currentState = {
    ...currentState,
    status: "error",
    message,
    error: message,
    updatedAt: Date.now(),
    installed: false,
  };
  return cloneState(currentState);
};
