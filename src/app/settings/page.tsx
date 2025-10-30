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

const localModelOptions = [
  { value: "Qwen/Qwen3-VL-2B-Instruct", label: "Qwen/Qwen3-VL-2B-Instruct" },
  { value: "Qwen/Qwen3-VL-4B-Instruct", label: "Qwen/Qwen3-VL-4B-Instruct" },
];

type LocalRunnerStatus = "unknown" | "checking" | "stopped" | "starting" | "running" | "stopping" | "error";

const localStatusLabels: Record<LocalRunnerStatus, string> = {
  unknown: "Status unknown",
  checking: "Checking…",
  stopped: "Stopped",
  starting: "Starting…",
  running: "Running",
  stopping: "Stopping…",
  error: "Error",
};

const normalizeLocalStatus = (value: unknown): LocalRunnerStatus => {
  if (typeof value === "string" && value in localStatusLabels) {
    return value as LocalRunnerStatus;
  }
  return "unknown";
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
  const [testing, setTesting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"info" | "success" | "error">("info");
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [testTone, setTestTone] = useState<"idle" | "success" | "error">("idle");
  const [localStatus, setLocalStatus] = useState<LocalRunnerStatus>("unknown");
  const [localStatusMessage, setLocalStatusMessage] = useState<string | null>(null);
  const [localInstalled, setLocalInstalled] = useState<boolean | null>(null);
  const statusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showStatus = (message: string, tone: "info" | "success" | "error" = "info") => {
    setStatusMessage(message);
    setStatusTone(tone);
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    statusTimeoutRef.current = setTimeout(() => setStatusMessage(null), 3600);
  };

  const fetchLocalRunnerStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/vlm/local/status", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok) {
        const status = normalizeLocalStatus(payload.status);
        setLocalStatus(status);
        setLocalStatusMessage(payload.message ?? payload.error ?? null);
        setLocalInstalled(typeof payload.installed === "boolean" ? payload.installed : null);
      } else {
        setLocalStatus("error");
        setLocalStatusMessage(payload.message ?? payload.error ?? "Unable to determine local service status.");
        setLocalInstalled(null);
      }
    } catch (error) {
      console.error("Failed to load local runner status", error);
      setLocalStatus("error");
      setLocalStatusMessage("Unable to contact local runner status endpoint.");
      setLocalInstalled(null);
    }
  }, []);

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

  useEffect(() => {
    if (!hydrated) return;
    if (settings.mode === "local") {
      fetchLocalRunnerStatus();
    }
  }, [fetchLocalRunnerStatus, hydrated, settings.mode]);

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
    if (mode !== "local") {
      setLocalInstalled(null);
      setLocalStatus("unknown");
      setLocalStatusMessage(null);
    }
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

  const handleLocalModelSelectChange = (value: string) => {
    updateSettings((draft) => {
      if (value === "custom") {
        const isPreset = localModelOptions.some((option) => option.value === draft.local.modelId);
        if (isPreset) {
          draft.local.modelId = "";
        }
        return;
      }
      draft.local.modelId = value;
    });
    setLocalInstalled(null);
    setLocalStatusMessage(null);
    setLocalStatus((prev) => (prev === "running" ? prev : "stopped"));
  };

  const handleLocalModelInputChange = (value: string) => {
    updateSettings((draft) => {
      draft.local.modelId = value;
    });
    setLocalInstalled(null);
    setLocalStatusMessage(null);
    setLocalStatus((prev) => (prev === "running" ? prev : "stopped"));
  };

  const handleCheckLocalModel = async () => {
    if (!hasLocalModelId) {
      const message = "Provide a model ID before checking availability.";
      setLocalStatus("error");
      setLocalInstalled(false);
      setLocalStatusMessage(message);
      showStatus(message, "error");
      return;
    }

    setLocalStatus("checking");
    setLocalStatusMessage(null);
    setLocalInstalled(null);

    try {
      const response = await fetch("/api/vlm/local/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: settings.local.modelId }),
      });
      const payload = await response.json();
      const status = normalizeLocalStatus(payload.status);
      const installed = typeof payload.installed === "boolean" ? payload.installed : null;

      if (!response.ok || payload.ok === false) {
        const message = payload.message ?? payload.error ?? "Unable to verify local model availability.";
        setLocalStatus(status === "unknown" ? "error" : status);
        setLocalInstalled(installed ?? false);
        setLocalStatusMessage(message);
        showStatus(message, "error");
        return;
      }

      const message = payload.message ?? payload.error ?? "Model is ready on this workstation.";
      setLocalStatus(status === "unknown" ? "stopped" : status);
      const resolvedInstalled = installed === true ? true : installed === false ? false : null;
      setLocalInstalled(resolvedInstalled);
      setLocalStatusMessage(message);
      showStatus(message, resolvedInstalled === false ? "error" : "success");
    } catch (error) {
      console.error("Failed to check local model availability", error);
      const message = "Unable to verify the local model. Check server logs.";
      setLocalStatus("error");
      setLocalInstalled(false);
      setLocalStatusMessage(message);
      showStatus(message, "error");
    }
  };

  const handleStartLocalService = async () => {
    setLocalStatus((prev) => (prev === "running" ? prev : "starting"));
    setLocalStatusMessage(null);
    try {
      const response = await fetch("/api/vlm/local/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: settings.local.modelId }),
      });
      const payload = await response.json();
      const status = normalizeLocalStatus(payload.status);
      if (!response.ok || payload.ok === false) {
        const message = payload.message ?? payload.error ?? "Unable to start local service.";
        setLocalStatus(status === "unknown" ? "error" : status);
        setLocalStatusMessage(message);
        setLocalInstalled(typeof payload.installed === "boolean" ? payload.installed : localInstalled);
        showStatus(message, "error");
        return;
      }
      setLocalStatus(status);
      setLocalStatusMessage(payload.message ?? payload.error ?? null);
      setLocalInstalled(typeof payload.installed === "boolean" ? payload.installed : true);
      showStatus(payload.message ?? "Local VLM service is running.", "success");
      await fetchLocalRunnerStatus();
    } catch (error) {
      console.error("Failed to start local VLM service", error);
      setLocalStatus("error");
      setLocalStatusMessage("Unable to start the local service. Check server logs.");
      setLocalInstalled(false);
      showStatus("Unable to start the local service. Check server logs.", "error");
    }
  };

  const handleStopLocalService = async () => {
    setLocalStatus((prev) => (prev === "stopped" ? prev : "stopping"));
    setLocalStatusMessage(null);
    try {
      const response = await fetch("/api/vlm/local/stop", { method: "POST" });
      const payload = await response.json();
      const status = normalizeLocalStatus(payload.status);
      if (!response.ok || payload.ok === false) {
        const message = payload.message ?? payload.error ?? "Unable to stop local service.";
        setLocalStatus(status === "unknown" ? "error" : status);
        setLocalStatusMessage(message);
        setLocalInstalled(typeof payload.installed === "boolean" ? payload.installed : localInstalled);
        showStatus(message, "error");
        return;
      }
      setLocalStatus(status);
      setLocalStatusMessage(payload.message ?? payload.error ?? null);
      setLocalInstalled(typeof payload.installed === "boolean" ? payload.installed : localInstalled);
      showStatus(payload.message ?? "Local VLM service stopped.", "success");
      await fetchLocalRunnerStatus();
    } catch (error) {
      console.error("Failed to stop local VLM service", error);
      setLocalStatus("error");
      setLocalStatusMessage("Unable to stop the local service. Check server logs.");
      setLocalInstalled(localInstalled);
      showStatus("Unable to stop the local service. Check server logs.", "error");
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

  const handleTestConnection = async () => {
    setTesting(true);
    setTestMessage(null);
    setTestTone("idle");
    try {
      const response = await fetch("/api/settings/vlm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const payload = await response.json();
      if (response.ok) {
        setTestTone("success");
        setTestMessage(payload.message || "Connection successful");
      } else {
        setTestTone("error");
        setTestMessage(payload.message || "Connection failed");
      }
    } catch (error) {
      console.error("Test connection failed", error);
      setTestTone("error");
      setTestMessage("Unable to reach endpoint");
    } finally {
      setTesting(false);
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

  const localModelId = settings.local.modelId;
  const presetMatch = localModelOptions.some((option) => option.value === localModelId);
  const localPresetValue = presetMatch ? localModelId : "custom";
  const isCustomLocalModel = localPresetValue === "custom";
  const hasLocalModelId = settings.local.modelId.trim().length > 0;
  const localStatusText = localStatusMessage ?? localStatusLabels[localStatus];
  const localStatusTextClass =
    localStatus === "running"
      ? "text-emerald-300"
      : localStatus === "error"
      ? "text-rose-300"
      : localStatus === "starting" || localStatus === "stopping" || localStatus === "checking"
      ? "text-amber-200"
      : "text-slate-300/80";
  const startDisabled =
    localStatus === "checking" || localStatus === "starting" || localStatus === "running" || !hasLocalModelId || localInstalled !== true;
  const stopDisabled =
    localStatus === "checking" || localStatus === "stopping" || localStatus === "stopped" || localStatus === "starting";
  const checkDisabled =
    !hasLocalModelId || localStatus === "checking" || localStatus === "starting" || localStatus === "stopping" || localStatus === "running";

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
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="secondary" onClick={handleTestConnection} disabled={testing}>
                  {testing ? "Testing…" : "Test connection"}
                </Button>
                {testMessage && (
                  <span
                    className={`text-sm ${
                      testTone === "success" ? "text-emerald-300" : testTone === "error" ? "text-rose-300" : "text-slate-300"
                    }`}
                  >
                    {testMessage}
                  </span>
                )}
              </div>
            </section>
          )}
          {settings.mode === "local" && (
            <section className="space-y-6 rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="space-y-3 rounded-2xl border border-amber-400/60 bg-amber-500/10 px-4 py-3">
                <h3 className="text-base font-semibold text-amber-200">Local runtime reminder</h3>
                <p className="text-sm text-amber-100/80">
                  Start the local VLM service before scanning orders. The scanner will communicate with your workstation via
                  the configured loopback ports and will not attempt any remote calls in this mode.
                </p>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <label className={fieldLabelClass} htmlFor="local-model-preset">
                    Model preset
                  </label>
                  <select
                    id="local-model-preset"
                    className={selectClass}
                    value={localPresetValue}
                    onChange={(event) => handleLocalModelSelectChange(event.target.value)}
                  >
                    {localModelOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                    <option value="custom">Custom…</option>
                  </select>
                  <p className={fieldDescriptionClass}>
                    Choose an optimized preset or supply your own model identifier for the local runner.
                  </p>
                </div>
                {isCustomLocalModel && (
                  <div className="space-y-2 md:col-span-2">
                    <label className={fieldLabelClass} htmlFor="local-custom-model">
                      Custom model ID
                    </label>
                    <Input
                      id="local-custom-model"
                      placeholder="user/your-vlm-model"
                      value={settings.local.modelId}
                      onChange={(event) => handleLocalModelInputChange(event.target.value)}
                      spellCheck={false}
                    />
                    <p className={fieldDescriptionClass}>
                      Enter the identifier expected by your local service (for example, <code>user/Qwen3-VL-4B-GGUF</code>).
                    </p>
                    {!settings.local.modelId.trim() && (
                      <p className="text-xs text-rose-300">Model ID is required to launch the local service.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className={fieldLabelClass}>Service status</p>
                  <p className={`text-sm ${localStatusTextClass}`}>{localStatusText}</p>
                </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="secondary" onClick={handleCheckLocalModel} disabled={checkDisabled}>
                  {localStatus === "checking"
                    ? "Checking…"
                    : localInstalled === true
                    ? "Re-check model"
                    : "Check model files"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleStartLocalService}
                  disabled={startDisabled}
                  title={
                    !hasLocalModelId
                      ? "Enter a model ID to continue."
                      : localInstalled === true
                      ? undefined
                      : "Check model files before starting the local service."
                  }
                >
                  {localStatus === "starting" ? "Starting…" : "Start local service"}
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    className="border-white/10 bg-transparent text-slate-200 hover:border-rose-400/60 hover:bg-rose-500/10 hover:text-rose-200"
                    onClick={handleStopLocalService}
                    disabled={stopDisabled}
                  >
                    {localStatus === "stopping" ? "Stopping…" : "Stop local service"}
                  </Button>
                </div>
              </div>
            </section>
          )}
        </div>
      </Card>

      {!hydrated && loading && <p className="text-sm text-slate-400">Loading VLM preferences…</p>}
    </div>
  );
}
