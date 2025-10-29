import { DEFAULT_VLM_SETTINGS } from "@/config/vlm";

export type LocalRunnerStatus = "stopped" | "starting" | "running" | "stopping" | "error";

export interface LocalRunnerState {
  status: LocalRunnerStatus;
  modelId: string | null;
  message: string;
  error: string | null;
  updatedAt: number;
}

const statusMessages: Record<Exclude<LocalRunnerStatus, "error">, string> = {
  stopped: "Local service is stopped.",
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
  };
};

let currentState: LocalRunnerState = {
  status: "stopped",
  modelId: DEFAULT_VLM_SETTINGS.local.modelId,
  message: statusMessages.stopped,
  error: null,
  updatedAt: Date.now(),
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

export const startLocalRunner = async (modelId: string): Promise<LocalRunnerState> => {
  const trimmed = modelId?.trim();
  if (!trimmed) {
    throw new Error("Model ID is required to start the local VLM service.");
  }

  if (currentState.status === "running" && currentState.modelId === trimmed) {
    return updateState({ message: `Local service already running (${trimmed}).` });
  }

  updateState({ status: "starting", modelId: trimmed, message: `Starting local service with ${trimmed}…` });

  return updateState({ status: "running", modelId: trimmed, message: `Local service running with ${trimmed}.` });
};

export const stopLocalRunner = async (): Promise<LocalRunnerState> => {
  if (currentState.status === "stopped") {
    return updateState({ message: "Local service already stopped.", modelId: null });
  }

  updateState({ status: "stopping", message: "Stopping local service…" });

  return updateState({ status: "stopped", modelId: null, message: "Local service stopped." });
};

export const markLocalRunnerError = (message: string): LocalRunnerState => {
  currentState = {
    ...currentState,
    status: "error",
    message,
    error: message,
    updatedAt: Date.now(),
  };
  return cloneState(currentState);
};
