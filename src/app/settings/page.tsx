"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_VLM_SETTINGS } from "@/config/vlm";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { VlmMode, VlmProviderType, VlmSettings } from "@/types/vlm";

const providerOptions: Array<{ value: VlmProviderType; label: string }> = [
  { value: "openai-compatible", label: "OpenAI-compatible" },
  { value: "huggingface", label: "Hugging Face Inference" },
  { value: "generic-http", label: "Generic HTTP (Custom)" },
];

const dtypeOptions: Array<{ value: string; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "bfloat16", label: "bfloat16" },
  { value: "float16", label: "float16" },
  { value: "float32", label: "float32" },
];

const deviceMapOptions: Array<{ value: string; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "cuda", label: "CUDA" },
  { value: "cpu", label: "CPU" },
];

type LocalModelPreset = "Qwen/Qwen3-VL-2B-Instruct" | "Qwen/Qwen3-VL-4B-Instruct" | "__custom__";

const localModelOptions: Array<{ value: LocalModelPreset; label: string }> = [
  { value: "Qwen/Qwen3-VL-2B-Instruct", label: "Qwen/Qwen3-VL-2B-Instruct" },
  { value: "Qwen/Qwen3-VL-4B-Instruct", label: "Qwen/Qwen3-VL-4B-Instruct" },
  { value: "__custom__", label: "Custom" },
];

type LocalServiceState = {
  state: "unknown" | "stopped" | "starting" | "running" | "error";
  modelId?: string;
  port?: number;
  startedAt?: number;
  message?: string;
  logs?: { stdout: string[]; stderr: string[] };
  lastExit?: { code: number | null; signal: string | null; at?: number };
};

const detectLocalModelPreset = (modelId: string): LocalModelPreset => {
  if (modelId === "Qwen/Qwen3-VL-2B-Instruct") return "Qwen/Qwen3-VL-2B-Instruct";
  if (modelId === "Qwen/Qwen3-VL-4B-Instruct") return "Qwen/Qwen3-VL-4B-Instruct";
  return "__custom__";
};

const sectionTitleClass = "text-sm font-semibold uppercase tracking-wide text-slate-300";
const fieldLabelClass = "text-sm font-medium text-slate-200";
const fieldDescriptionClass = "text-xs text-slate-400";
const selectClass =
  "w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-400/60";
const cloneSettings = (value: VlmSettings): VlmSettings => structuredClone(value);

export default function SettingsPage() {
  const [settings, setSettings] = useState<VlmSettings>(() => cloneSettings(DEFAULT_VLM_SETTINGS));
  const [hydrated, setHydrated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"info" | "success" | "error">("info");
  const statusTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [localModelPreset, setLocalModelPreset] = useState<LocalModelPreset>(() =>
    detectLocalModelPreset(DEFAULT_VLM_SETTINGS.local.modelId),
  );
  const [customModelId, setCustomModelId] = useState(DEFAULT_VLM_SETTINGS.local.modelId);
  const [checkingLocalModel, setCheckingLocalModel] = useState(false);
  const [localCheckStatus, setLocalCheckStatus] = useState<"idle" | "success" | "error">("idle");
  const [localCheckMessage, setLocalCheckMessage] = useState<string | null>(null);
  const [localServiceState, setLocalServiceState] = useState<LocalServiceState>({ state: "unknown" });
  const [startingLocalService, setStartingLocalService] = useState(false);
  const [stoppingLocalService, setStoppingLocalService] = useState(false);

  const showStatus = (message: string, tone: "info" | "success" | "error" = "info") => {
    setStatusMessage(message);
    setStatusTone(tone);
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    statusTimeoutRef.current = setTimeout(() => setStatusMessage(null), 3600);
  };

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await fetch("/api/settings/vlm", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Failed to load settings (${response.status})`);
        }
        const payload = await response.json();
        const next = payload?.settings ? cloneSettings(payload.settings as VlmSettings) : cloneSettings(DEFAULT_VLM_SETTINGS);
        setSettings(next);
        setDirty(false);
      } catch (error) {
        console.error("Failed to load VLM settings", error);
        showStatus("Unable to load settings. Using defaults until saved.", "error");
        setSettings(cloneSettings(DEFAULT_VLM_SETTINGS));
      } finally {
        setHydrated(true);
        setLoading(false);
      }
    };

    fetchSettings();
    return () => {
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
    };
  }, []);

  const refreshLocalServiceStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/vlm/local/service", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.ok) {
        const status = payload.status as {
          state?: "stopped" | "starting" | "running";
          modelId?: string;
          port?: number;
          startedAt?: number;
          message?: string;
          logs?: { stdout?: unknown; stderr?: unknown } | null;
          lastExit?: { code?: unknown; signal?: unknown; at?: unknown } | null;
        } | null;
        if (status) {
          setLocalServiceState({
            state: status.state ?? "stopped",
            modelId: status.modelId ?? undefined,
            port: typeof status.port === "number" ? status.port : undefined,
            startedAt: typeof status.startedAt === "number" ? status.startedAt : undefined,
            message: typeof status.message === "string" ? status.message : undefined,
            logs:
              status.logs && typeof status.logs === "object"
                ? {
                    stdout: Array.isArray(status.logs.stdout)
                      ? (status.logs.stdout as unknown[]).map((entry) => String(entry))
                      : [],
                    stderr: Array.isArray(status.logs.stderr)
                      ? (status.logs.stderr as unknown[]).map((entry) => String(entry))
                      : [],
                  }
                : undefined,
            lastExit:
              status.lastExit && typeof status.lastExit === "object"
                ? {
                    code:
                      typeof status.lastExit.code === "number" || status.lastExit.code === null
                        ? (status.lastExit.code as number | null)
                        : null,
                    signal:
                      typeof status.lastExit.signal === "string"
                        ? (status.lastExit.signal as string)
                        : null,
                    at:
                      typeof status.lastExit.at === "number"
                        ? (status.lastExit.at as number)
                        : undefined,
                  }
                : undefined,
          });
        } else {
          setLocalServiceState({ state: "stopped" });
        }
      } else {
        setLocalServiceState({
          state: "error",
          message:
            typeof payload?.message === "string"
              ? payload.message
              : "Unable to determine local model service status.",
        });
      }
    } catch (error) {
      console.error("Failed to load local service status", error);
      setLocalServiceState({
        state: "error",
        message: "Unable to reach the local model service status endpoint.",
      });
    }
  }, []);

  useEffect(() => {
    refreshLocalServiceStatus();
  }, [refreshLocalServiceStatus]);

  useEffect(() => {
    if (settings.mode === "local") {
      refreshLocalServiceStatus();
    } else {
      setLocalServiceState({ state: "stopped" });
    }
  }, [settings.mode, refreshLocalServiceStatus]);

  const handleStartLocalService = async () => {
    if (localCheckStatus !== "success") {
      setLocalServiceState({
        state: "error",
        message: "Verify the model cache before starting the local service.",
      });
      return;
    }

    setStartingLocalService(true);

    try {
      const response = await fetch("/api/settings/vlm/local/service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: settings.local.modelId,
          dtype: settings.local.dtype,
          deviceMap: settings.local.deviceMap,
          maxNewTokens: settings.local.maxNewTokens,
          enableFlashAttention2: settings.local.enableFlashAttention2,
          systemPrompt: settings.remote.defaults.systemPrompt,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.ok) {
        const status = payload.status as {
          state?: "stopped" | "starting" | "running";
          modelId?: string;
          port?: number;
          startedAt?: number;
          message?: string;
          logs?: { stdout?: unknown; stderr?: unknown } | null;
          lastExit?: { code?: unknown; signal?: unknown; at?: unknown } | null;
        } | null;
        if (status) {
          setLocalServiceState({
            state: status.state ?? "running",
            modelId: status.modelId ?? settings.local.modelId,
            port: typeof status.port === "number" ? status.port : undefined,
            startedAt: typeof status.startedAt === "number" ? status.startedAt : undefined,
            message: typeof status.message === "string" ? status.message : undefined,
            logs:
              status.logs && typeof status.logs === "object"
                ? {
                    stdout: Array.isArray(status.logs.stdout)
                      ? (status.logs.stdout as unknown[]).map((entry) => String(entry))
                      : [],
                    stderr: Array.isArray(status.logs.stderr)
                      ? (status.logs.stderr as unknown[]).map((entry) => String(entry))
                      : [],
                  }
                : undefined,
            lastExit:
              status.lastExit && typeof status.lastExit === "object"
                ? {
                    code:
                      typeof status.lastExit.code === "number" || status.lastExit.code === null
                        ? (status.lastExit.code as number | null)
                        : null,
                    signal:
                      typeof status.lastExit.signal === "string"
                        ? (status.lastExit.signal as string)
                        : null,
                    at:
                      typeof status.lastExit.at === "number"
                        ? (status.lastExit.at as number)
                        : undefined,
                  }
                : undefined,
          });
          await refreshLocalServiceStatus();
        } else {
          setLocalServiceState({ state: "starting" });
        }
      } else {
        setLocalServiceState({
          state: "error",
          message:
            typeof payload?.message === "string"
              ? payload.message
              : "Failed to start the local model service.",
        });
      }
    } catch (error) {
      console.error("Failed to start local model service", error);
      setLocalServiceState({
        state: "error",
        message: "Unable to start the local model service.",
      });
    } finally {
      setStartingLocalService(false);
    }
  };

  const handleStopLocalService = async () => {
    setStoppingLocalService(true);
    try {
      const response = await fetch("/api/settings/vlm/local/service", { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.ok) {
        setLocalServiceState({ state: "stopped" });
        await refreshLocalServiceStatus();
      } else if (!response.ok) {
        setLocalServiceState({
          state: "error",
          message:
            typeof payload?.message === "string"
              ? payload.message
              : "Failed to stop the local model service.",
        });
      } else {
        setLocalServiceState({ state: "stopped" });
        await refreshLocalServiceStatus();
      }
    } catch (error) {
      console.error("Failed to stop local model service", error);
      setLocalServiceState({
        state: "error",
        message: "Unable to stop the local model service.",
      });
    } finally {
      setStoppingLocalService(false);
    }
  };

  useEffect(() => {
    const preset = detectLocalModelPreset(settings.local.modelId);
    setLocalModelPreset(preset);
    if (preset === "__custom__") {
      setCustomModelId(settings.local.modelId);
    }
  }, [settings.local.modelId]);

  useEffect(() => {
    setLocalCheckStatus("idle");
    setLocalCheckMessage(null);
  }, [settings.local.modelId]);

  const updateSettings = (mutator: (draft: VlmSettings) => void) => {
    setSettings((prev) => {
      const draft = cloneSettings(prev);
      mutator(draft);
      setDirty(true);
      return draft;
    });
  };

  const handleModeChange = (mode: VlmMode) => {
    updateSettings((draft) => {
      draft.mode = mode;
    });
  };

  const handleProviderTypeChange = (providerType: VlmProviderType) => {
    updateSettings((draft) => {
      const remote = draft.remote;
      if (remote.providerType === providerType) return;
      remote.providerType = providerType;

      switch (providerType) {
        case "openai-compatible": {
          if (!remote.baseUrl) {
            remote.baseUrl = "https://api.openai.com/v1/chat/completions";
          }
          remote.authScheme = "bearer";
          remote.authHeaderName = "Authorization";
          break;
        }
        case "huggingface": {
          remote.baseUrl = "";
          remote.authScheme = "bearer";
          remote.authHeaderName = "Authorization";
          if (!remote.hfProvider) {
            remote.hfProvider = "";
          }
          break;
        }
        case "generic-http": {
          if (!remote.baseUrl) {
            remote.baseUrl = "";
          }
          remote.authScheme = "api-key-header";
          if (!remote.authHeaderName || remote.authHeaderName.toLowerCase() === "authorization") {
            remote.authHeaderName = "X-API-Key";
          }
          break;
        }
        default:
          break;
      }
    });
  };

  const handleRemoteChange = <K extends keyof VlmSettings["remote"]>(key: K, value: VlmSettings["remote"][K]) => {
    updateSettings((draft) => {
      (draft.remote as any)[key] = value;
    });
  };

  const handleDefaultChange = (key: keyof VlmSettings["remote"]["defaults"], value: unknown) => {
    updateSettings((draft) => {
      if (key === "stopSequences" && typeof value === "string") {
        draft.remote.defaults.stopSequences = value
          .split(/\r?\n/)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
        return;
      }
      (draft.remote.defaults as any)[key] = value;
    });
  };

  const handleLocalChange = <K extends keyof VlmSettings["local"]>(key: K, value: VlmSettings["local"][K]) => {
    updateSettings((draft) => {
      (draft.local as any)[key] = value;
    });
  };

  const handleLocalModelPresetChange = (preset: LocalModelPreset) => {
    setLocalModelPreset(preset);
    const nextModelId = preset === "__custom__" ? customModelId : preset;
    updateSettings((draft) => {
      draft.local.modelId = nextModelId;
    });
  };

  const handleCustomModelIdChange = (value: string) => {
    setCustomModelId(value);
    updateSettings((draft) => {
      draft.local.modelId = value;
    });
  };

  const handleCheckLocalModel = async () => {
    const modelId = settings.local.modelId.trim();
    if (!modelId) {
      setLocalCheckStatus("error");
      setLocalCheckMessage("Enter a model repository to verify.");
      return;
    }

    setCheckingLocalModel(true);
    setLocalCheckStatus("idle");
    setLocalCheckMessage(null);

    try {
      const response = await fetch("/api/settings/vlm/local/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.ok) {
        setLocalCheckStatus("success");
        setLocalCheckMessage(typeof payload.message === "string" ? payload.message : "Model cache verified.");
      } else {
        setLocalCheckStatus("error");
        setLocalCheckMessage(
          typeof payload?.message === "string"
            ? payload.message
            : "Model files not found locally. Download them before continuing.",
        );
      }
    } catch (error) {
      console.error("Failed to verify local model", error);
      setLocalCheckStatus("error");
      setLocalCheckMessage("Unable to verify model availability. Ensure the server can run Python checks.");
    } finally {
      setCheckingLocalModel(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/settings/vlm", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!response.ok) {
        throw new Error(`Save failed with status ${response.status}`);
      }
      const payload = await response.json();
      setSettings(cloneSettings(payload.settings as VlmSettings));
      setDirty(false);
      showStatus("Preferences saved", "success");
    } catch (error) {
      console.error("Failed to save VLM settings", error);
      showStatus("Unable to save settings. Please retry.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/settings/vlm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset" }),
      });
      if (!response.ok) {
        throw new Error(`Reset failed with status ${response.status}`);
      }
      const payload = await response.json();
      setSettings(cloneSettings(payload.settings as VlmSettings));
      setDirty(false);
      showStatus("Settings restored to defaults", "success");
    } catch (error) {
      console.error("Failed to reset VLM settings", error);
      showStatus("Unable to reset settings. Please retry.", "error");
    } finally {
      setSaving(false);
    }
  };

  const modeDescription = useMemo(() => {
    const copy: Record<VlmMode, string> = {
      local:
        "Runs entirely on this workstation. Ideal for air-gapped demos or when you have GPU capacity on site.",
      remote:
        "Connects to a hosted VLM service. Recommended for production scenarios where you need elastic scale and automatic updates.",
    };
    return copy;
  }, []);

  const remote = settings.remote;
  const local = settings.local;
  const providerType = remote.providerType;
  const baseUrlDisabled = providerType === "huggingface";
  const baseUrlPlaceholder =
    providerType === "openai-compatible"
      ? "https://api.openai.com/v1/chat/completions"
      : providerType === "generic-http"
      ? "https://your-service.example.com/v1/ocr"
      : "Hugging Face uses managed endpoints";
  const baseUrlHelperCopy =
    providerType === "huggingface"
      ? "Hugging Face Inference selects the endpoint automatically when you provide a model and API token."
      : providerType === "generic-http"
      ? "Provide the full URL your custom inference service expects requests on."
      : "The OpenAI-compatible chat/completions endpoint to post OCR prompts to.";
  const showProviderField = providerType === "huggingface";
  const providerFieldDescription = showProviderField
    ? "Required when routing through Hugging Face Inference. Use the slug from your provider (e.g. mistralai, hyperbolic)."
    : "";

  const serviceTone =
    localServiceState.state === "running"
      ? "text-emerald-300"
      : localServiceState.state === "error"
      ? "text-rose-300"
      : localServiceState.state === "starting"
      ? "text-indigo-300"
      : "text-slate-300/80";

  const formatTimestamp = useCallback(
    (timestamp?: number | null) => {
      if (!timestamp || !hydrated) {
        return null;
      }
      return new Date(timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    },
    [hydrated],
  );

  const lastExitSummary = useMemo(() => {
    const exit = localServiceState.lastExit;
    if (!exit) return null;
    const parts: string[] = [];
    if (typeof exit.code === "number") {
      parts.push(`code ${exit.code}`);
    }
    if (exit.signal) {
      parts.push(`signal ${exit.signal}`);
    }
    const time = formatTimestamp(exit.at ?? null);
    if (!parts.length && !time) return null;
    if (parts.length && time) {
      return `Last exit (${parts.join(", ")}) at ${time}.`;
    }
    if (parts.length) {
      return `Last exit (${parts.join(", ")}).`;
    }
    return time ? `Last exit at ${time}.` : null;
  }, [localServiceState.lastExit, formatTimestamp]);

  const serviceMessage = (() => {
    switch (localServiceState.state) {
      case "running": {
        const port = localServiceState.port;
        const since =
          localServiceState.startedAt && Number.isFinite(localServiceState.startedAt)
            ? formatTimestamp(localServiceState.startedAt)
            : null;
        const base = port
          ? `Running on http://127.0.0.1:${port}.`
          : "Local model service is running.";
        return since ? `${base} Started at ${since}.` : base;
      }
      case "starting":
        return "Starting the local model service…";
      case "stopped":
        return localServiceState.message || "Service is currently stopped.";
      case "error":
        return localServiceState.message || "Unable to reach the local model service.";
      case "unknown":
      default:
        return "Checking local model service status…";
    }
  })();

  const startDisabled =
    localCheckStatus !== "success" || startingLocalService || stoppingLocalService;
  const stopDisabled = stoppingLocalService || startingLocalService;
  const startLabel = startingLocalService ? "Starting…" : "Start model";
  const stopLabel = stoppingLocalService ? "Stopping…" : "Stop service";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold text-slate-100">Settings</h1>
        <p className="text-base text-slate-300/90">
          Configure how the vision-language model (VLM) runs and tune the integration parameters for your deployment.
        </p>
        {statusMessage && (
          <div
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-1 text-sm font-medium ${
              statusTone === "success"
                ? "border-emerald-400/60 bg-emerald-500/10 text-emerald-300"
                : statusTone === "error"
                ? "border-rose-400/60 bg-rose-500/10 text-rose-300"
                : "border-indigo-400/40 bg-indigo-500/10 text-indigo-200"
            }`}
          >
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                statusTone === "success"
                  ? "bg-emerald-400"
                  : statusTone === "error"
                  ? "bg-rose-400"
                  : "bg-indigo-300"
              }`}
              aria-hidden
            />
            {statusMessage}
          </div>
        )}
      </div>

      <Card
        header={
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-100">Vision-Language Model</h2>
              <p className="text-sm text-slate-300/80">
                Choose whether to run the VLM locally or through a remote API. Remote mode unlocks both quick setup and deep
                configuration controls.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                className="border-white/10 bg-white/5 text-sm text-slate-200 hover:border-indigo-400/60 hover:bg-indigo-500/10"
                onClick={handleReset}
                disabled={saving}
              >
                Reset to defaults
              </Button>
              <Button type="button" onClick={handleSave} disabled={saving || !dirty}>
                {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
              </Button>
            </div>
          </div>
        }
        className="border border-white/10 bg-slate-900/60"
      >
        <div className="space-y-8">
          <section className="space-y-4">
            <div className="space-y-1">
              <p className={sectionTitleClass}>Execution mode</p>
              <p className={fieldDescriptionClass}>
                Local mode keeps traffic on-device, while remote mode forwards scans to a hosted inference service.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {(["remote", "local"] as VlmMode[]).map((mode) => {
                const active = settings.mode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => handleModeChange(mode)}
                    className={`flex w-full flex-col items-start gap-2 rounded-2xl border px-4 py-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                      active
                        ? "border-indigo-400/60 bg-indigo-500/10 text-slate-100"
                        : "border-white/10 bg-white/5 text-slate-300/80 hover:border-indigo-400/40 hover:bg-indigo-500/5"
                    }`}
                  >
                    <span className="text-base font-semibold text-slate-100 capitalize">{mode} service</span>
                    <span className="text-sm text-slate-300/80">{modeDescription[mode]}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {settings.mode === "remote" && (
            <section className="space-y-5 rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="space-y-2">
                <p className="text-lg font-semibold text-slate-100">Quick setup</p>
                <p className="text-sm text-slate-300/80">
                  Provide the essentials most teams need to connect to a hosted VLM.
                </p>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <label className={fieldLabelClass} htmlFor="provider-type">
                    Provider type
                  </label>
                  <select
                    id="provider-type"
                    className={selectClass}
                    value={remote.providerType}
                    onChange={(event) => handleProviderTypeChange(event.target.value as VlmProviderType)}
                  >
                    {providerOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className={fieldLabelClass} htmlFor="remote-base-url">
                    {providerType === "huggingface" ? "Endpoint override (optional)" : "Base URL / Endpoint"}
                  </label>
                  <Input
                    id="remote-base-url"
                    placeholder={baseUrlPlaceholder}
                    value={remote.baseUrl}
                    onChange={(event) => handleRemoteChange("baseUrl", event.target.value)}
                    spellCheck={false}
                    disabled={baseUrlDisabled}
                  />
                  <p className={fieldDescriptionClass}>{baseUrlHelperCopy}</p>
                </div>
                <div className="space-y-2">
                  <label className={fieldLabelClass} htmlFor="remote-model-id">
                    Model ID / Deployment name
                  </label>
                  <Input
                    id="remote-model-id"
                    placeholder="gpt-4o-mini"
                    value={remote.modelId}
                    onChange={(event) => handleRemoteChange("modelId", event.target.value)}
                  />
                </div>
                {showProviderField && (
                  <div className="space-y-2">
                    <label className={fieldLabelClass} htmlFor="remote-hf-provider">
                      Hugging Face provider <span className="text-rose-300">*</span>
                    </label>
                    <Input
                      id="remote-hf-provider"
                      placeholder="mistralai"
                      value={remote.hfProvider}
                      onChange={(event) => handleRemoteChange("hfProvider", event.target.value)}
                      required
                    />
                    <p className={fieldDescriptionClass}>{providerFieldDescription}</p>
                    {!remote.hfProvider.trim() && (
                      <p className="text-xs text-rose-300">This field is required for Hugging Face integrations.</p>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  <label className={fieldLabelClass} htmlFor="remote-api-key">
                    API key / Token
                  </label>
                  <Input
                    id="remote-api-key"
                    type="password"
                    placeholder="••••••••••"
                    value={remote.apiKey}
                    onChange={(event) => handleRemoteChange("apiKey", event.target.value)}
                  />
                  <p className={fieldDescriptionClass}>Stored securely on the server and injected only at runtime.</p>
                </div>
                {providerType === "generic-http" && (
                  <div className="space-y-2">
                    <label className={fieldLabelClass} htmlFor="remote-api-header">
                      API key header
                    </label>
                    <Input
                      id="remote-api-header"
                      placeholder="X-API-Key"
                      value={remote.authHeaderName}
                      onChange={(event) => handleRemoteChange("authHeaderName", event.target.value)}
                    />
                    <p className={fieldDescriptionClass}>
                      The header name your custom endpoint expects for authentication.
                    </p>
                  </div>
                )}
              </div>
              <div className="grid gap-5 md:grid-cols-3">
                <div className="space-y-2">
                  <span className={fieldLabelClass}>Streaming</span>
                  <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-white/20 bg-slate-900"
                      checked={remote.defaults.streaming}
                      onChange={(event) => handleDefaultChange("streaming", event.target.checked)}
                    />
                    Enable server-sent streaming
                  </label>
                </div>
                <div className="space-y-2">
                  <label className={fieldLabelClass} htmlFor="remote-temperature">
                    Temperature
                  </label>
                  <Input
                    id="remote-temperature"
                    type="number"
                    step={0.05}
                    value={remote.defaults.temperature}
                    onChange={(event) => handleDefaultChange("temperature", Number(event.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <label className={fieldLabelClass} htmlFor="remote-max-output">
                    Max output tokens
                  </label>
                  <Input
                    id="remote-max-output"
                    type="number"
                    min={1}
                    value={remote.defaults.maxOutputTokens}
                    onChange={(event) => handleDefaultChange("maxOutputTokens", Number(event.target.value))}
                  />
                </div>
              </div>
            </section>
          )}
          {settings.mode === "local" && (
            <section className="space-y-5 rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="space-y-2">
                <p className="text-lg font-semibold text-slate-100">Local runtime configuration</p>
                <p className="text-sm text-slate-300/80">
                  Pick the local model repository, verify that its weights are downloaded, then unlock the runtime tuning controls.
                </p>
              </div>
              <div className="space-y-4">
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className={fieldLabelClass} htmlFor="local-model-preset">
                      Model repository
                    </label>
                    <select
                      id="local-model-preset"
                      className={selectClass}
                      value={localModelPreset}
                      onChange={(event) => handleLocalModelPresetChange(event.target.value as LocalModelPreset)}
                    >
                      {localModelOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className={fieldDescriptionClass}>
                      Choose a supported Qwen build or switch to a custom Hugging Face repository for advanced scenarios.
                    </p>
                  </div>
                  {localModelPreset === "__custom__" && (
                    <div className="space-y-2">
                      <label className={fieldLabelClass} htmlFor="local-model-custom">
                        Custom model ID
                      </label>
                      <Input
                        id="local-model-custom"
                        placeholder="username/model-name"
                        value={customModelId}
                        onChange={(event) => handleCustomModelIdChange(event.target.value)}
                        spellCheck={false}
                      />
                      <p className={fieldDescriptionClass}>Use the exact repository slug from Hugging Face.</p>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" variant="secondary" onClick={handleCheckLocalModel} disabled={checkingLocalModel}>
                    {checkingLocalModel ? "Checking…" : "Check model files"}
                  </Button>
                  {localCheckMessage && (
                    <div
                      className={`text-sm whitespace-pre-line ${
                        localCheckStatus === "success"
                          ? "text-emerald-300"
                          : localCheckStatus === "error"
                          ? "text-rose-300"
                          : "text-slate-300/80"
                      }`}
                    >
                      {localCheckMessage}
                    </div>
                  )}
                </div>
                <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className={fieldLabelClass}>Local model service</p>
                      <p className={fieldDescriptionClass}>
                        Run the background HTTP server to keep the model warm for faster inference.
                      </p>
                    </div>
                    {localServiceState.state === "running" ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={handleStopLocalService}
                        disabled={stopDisabled}
                      >
                        {stopLabel}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        onClick={handleStartLocalService}
                        disabled={startDisabled}
                      >
                        {startLabel}
                      </Button>
                    )}
                  </div>
                  <p className={`text-xs ${serviceTone}`}>{serviceMessage}</p>
                  {localServiceState.logs &&
                    (localServiceState.logs.stdout.length > 0 || localServiceState.logs.stderr.length > 0) &&
                    localServiceState.state !== "running" && (
                      <div className="space-y-3 rounded-xl border border-white/5 bg-slate-950/60 p-3">
                        {lastExitSummary && (
                          <p className="text-[11px] text-slate-400">{lastExitSummary}</p>
                        )}
                        {localServiceState.logs.stdout.length > 0 && (
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">Stdout tail</p>
                            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-300/80">
                              {localServiceState.logs.stdout.join("\n")}
                            </pre>
                          </div>
                        )}
                        {localServiceState.logs.stderr.length > 0 && (
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-rose-300/90">Stderr tail</p>
                            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-rose-200/80">
                              {localServiceState.logs.stderr.join("\n")}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                </div>
              </div>
              {localCheckStatus === "success" ? (
                <>
                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className={fieldLabelClass} htmlFor="local-dtype">
                        Compute dtype
                      </label>
                      <select
                        id="local-dtype"
                        className={selectClass}
                        value={local.dtype}
                        onChange={(event) => handleLocalChange("dtype", event.target.value)}
                      >
                        {dtypeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <p className={fieldDescriptionClass}>Use bfloat16/float16 for accelerated GPU inference when supported.</p>
                    </div>
                    <div className="space-y-2">
                      <label className={fieldLabelClass} htmlFor="local-device-map">
                        Device map
                      </label>
                      <select
                        id="local-device-map"
                        className={selectClass}
                        value={local.deviceMap}
                        onChange={(event) => handleLocalChange("deviceMap", event.target.value)}
                      >
                        {deviceMapOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <p className={fieldDescriptionClass}>
                        “Auto” lets Transformers place layers across available devices. Use “cuda” or “cpu” to force a target.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label className={fieldLabelClass} htmlFor="local-max-new-tokens">
                        Max new tokens
                      </label>
                      <Input
                        id="local-max-new-tokens"
                        type="number"
                        min={64}
                        max={4096}
                        step={32}
                        value={local.maxNewTokens}
                        onChange={(event) => {
                          const parsed = Number.parseInt(event.target.value, 10);
                          handleLocalChange(
                            "maxNewTokens",
                            Number.isFinite(parsed) ? Math.max(64, parsed) : local.maxNewTokens,
                          );
                        }}
                      />
                      <p className={fieldDescriptionClass}>Controls how much text the model can emit for each scan.</p>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className={`${fieldLabelClass} flex items-center gap-3`} htmlFor="local-flash-attn">
                        <input
                          id="local-flash-attn"
                          type="checkbox"
                          checked={local.enableFlashAttention2}
                          onChange={(event) => handleLocalChange("enableFlashAttention2", event.target.checked)}
                          className="h-4 w-4 rounded border border-white/20 bg-slate-900/60 text-indigo-400 focus:ring-2 focus:ring-indigo-400"
                        />
                        Enable FlashAttention 2
                      </label>
                      <p className={fieldDescriptionClass}>
                        Requires a compatible GPU and recent PyTorch/Transformers builds. Disable if you encounter kernel errors.
                      </p>
                    </div>
                  </div>
                  <p className={fieldDescriptionClass}>
                    The scanner will launch the Python OCR script with these parameters. Adjust them to match your workstation’s
                    hardware and model preferences.
                  </p>
                </>
              ) : (
                <p className={`${fieldDescriptionClass} italic`}>
                  Verify the model files above to unlock local runtime tuning.
                </p>
              )}
            </section>
          )}
          {settings.mode === "local" && (
            <section className="space-y-3 rounded-2xl border border-amber-400/60 bg-amber-500/10 px-5 py-4">
              <h3 className="text-base font-semibold text-amber-200">Local runtime reminder</h3>
              <p className="text-sm text-amber-100/80">
                Start the local VLM service before scanning orders. The scanner will communicate with your workstation via the
                configured loopback ports and will not attempt any remote calls in this mode.
              </p>
            </section>
          )}
        </div>
      </Card>

      {!hydrated && loading && <p className="text-sm text-slate-400">Loading VLM preferences…</p>}
    </div>
  );
}
