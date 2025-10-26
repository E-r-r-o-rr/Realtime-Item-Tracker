"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_VLM_SETTINGS } from "@/config/vlm";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  KeyValuePair,
  VlmMode,
  VlmProviderType,
  VlmResponseFormat,
  VlmSettings,
  VlmResponsePersistence,
  VlmPromptLoggingLevel,
  VlmToolInvocationPolicy,
  VlmRetryStrategy,
  VlmCorsMode,
  VlmChunkingStrategy,
  VlmImageHandlingMode,
} from "@/types/vlm";

const providerOptions: Array<{ value: VlmProviderType; label: string }> = [
  { value: "openai-compatible", label: "OpenAI-compatible" },
  { value: "huggingface", label: "Hugging Face Inference" },
  { value: "anthropic-compatible", label: "Anthropic-compatible" },
  { value: "azure-openai", label: "Azure OpenAI" },
  { value: "generic-http", label: "Generic HTTP (Custom)" },
];

const responseFormatOptions: Array<{ value: VlmResponseFormat; label: string }> = [
  { value: "text", label: "Free-text" },
  { value: "json", label: "JSON" },
  { value: "json-schema", label: "JSON schema" },
];

const persistenceOptions: Array<{ value: VlmResponsePersistence; label: string }> = [
  { value: "never", label: "Never" },
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
];

const loggingOptions: Array<{ value: VlmPromptLoggingLevel; label: string }> = [
  { value: "off", label: "Off" },
  { value: "redacted", label: "Redacted" },
  { value: "full", label: "Full" },
];

const toolPolicyOptions: Array<{ value: VlmToolInvocationPolicy; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "none", label: "Disabled" },
  { value: "required", label: "Required" },
];

const retryStrategyOptions: Array<{ value: VlmRetryStrategy; label: string }> = [
  { value: "none", label: "None" },
  { value: "linear", label: "Linear" },
  { value: "exponential", label: "Exponential" },
];

const corsOptions: Array<{ value: VlmCorsMode; label: string }> = [
  { value: "cors", label: "CORS" },
  { value: "no-cors", label: "No CORS" },
  { value: "same-origin", label: "Same origin" },
];

const chunkingOptions: Array<{ value: VlmChunkingStrategy; label: string }> = [
  { value: "tokens", label: "Tokens" },
  { value: "sentences", label: "Sentences" },
];

const imageHandlingOptions: Array<{ value: VlmImageHandlingMode; label: string }> = [
  { value: "upload", label: "Upload bytes" },
  { value: "url", label: "Image URL" },
  { value: "base64", label: "Base64" },
];

const sectionTitleClass = "text-sm font-semibold uppercase tracking-wide text-slate-300";
const fieldLabelClass = "text-sm font-medium text-slate-200";
const fieldDescriptionClass = "text-xs text-slate-400";
const advancedHintClass = "text-xs text-slate-400";
const selectClass =
  "w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-400/60";
const textareaClass =
  "w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-100 shadow-inner focus:outline-none focus:ring-2 focus:ring-indigo-400/60";

const cloneSettings = (value: VlmSettings): VlmSettings => structuredClone(value);

const makeHeader = (): KeyValuePair => ({
  id:
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10),
  key: "",
  value: "",
});

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
  const statusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  const handleRemoteChange = <K extends keyof VlmSettings["remote"]>(key: K, value: VlmSettings["remote"][K]) => {
    updateSettings((draft) => {
      (draft.remote as any)[key] = value;
    });
  };

  const handleCapabilityChange = (key: keyof VlmSettings["remote"]["capabilities"], value: any) => {
    updateSettings((draft) => {
      (draft.remote.capabilities as any)[key] = value;
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

  const handleRateLimitChange = (key: keyof VlmSettings["remote"]["rateLimits"], value: string) => {
    updateSettings((draft) => {
      const numeric = value.trim() === "" ? null : Number(value);
      draft.remote.rateLimits[key] = Number.isFinite(numeric as number) ? (numeric as number) : null;
    });
  };

  const handleRetryChange = (key: keyof VlmSettings["remote"]["retryPolicy"], value: string | number) => {
    updateSettings((draft) => {
      if (key === "strategy") {
        draft.remote.retryPolicy.strategy = value as VlmRetryStrategy;
      } else {
        draft.remote.retryPolicy[key] = Math.max(0, Number(value) || 0);
      }
    });
  };

  const handleCircuitChange = (key: keyof VlmSettings["remote"]["circuitBreaker"], value: string) => {
    updateSettings((draft) => {
      draft.remote.circuitBreaker[key] = Math.max(0, Number(value) || 0);
    });
  };

  const handleParameterMappingChange = (key: keyof VlmSettings["remote"]["parameterMapping"], value: string) => {
    updateSettings((draft) => {
      (draft.remote.parameterMapping as any)[key] = value;
    });
  };

  const handleLoggingChange = (key: keyof VlmSettings["remote"]["logging"], value: any) => {
    updateSettings((draft) => {
      if (key === "costTracking") {
        draft.remote.logging.costTracking = { ...draft.remote.logging.costTracking, ...value };
      } else {
        (draft.remote.logging as any)[key] = value;
      }
    });
  };

  const handleOcrChange = (key: keyof VlmSettings["remote"]["ocr"], value: any) => {
    updateSettings((draft) => {
      const current = (draft.remote.ocr as any)[key];
      (draft.remote.ocr as any)[key] = typeof current === "number" ? Math.max(0, Number(value) || 0) : value;
    });
  };

  const addHeader = () => {
    updateSettings((draft) => {
      draft.remote.extraHeaders.push(makeHeader());
    });
  };

  const updateHeader = (id: string, patch: Partial<KeyValuePair>) => {
    updateSettings((draft) => {
      draft.remote.extraHeaders = draft.remote.extraHeaders.map((header) =>
        header.id === id ? { ...header, ...patch } : header,
      );
    });
  };

  const removeHeader = (id: string) => {
    updateSettings((draft) => {
      draft.remote.extraHeaders = draft.remote.extraHeaders.filter((header) => header.id !== id);
    });
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
            <>
              <section className="space-y-5 rounded-2xl border border-white/10 bg-white/5 p-5">
                <div className="space-y-2">
                  <p className="text-lg font-semibold text-slate-100">Quick setup</p>
                  <p className="text-sm text-slate-300/80">
                    Provide the essentials most teams need to connect to a hosted VLM. Advanced controls remain available below
                    when you need deeper tuning.
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
                      onChange={(event) => handleRemoteChange("providerType", event.target.value as VlmProviderType)}
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
                      Base URL / Endpoint
                    </label>
                    <Input
                      id="remote-base-url"
                      placeholder="https://api.example.com/v1/chat/completions"
                      value={remote.baseUrl}
                      onChange={(event) => handleRemoteChange("baseUrl", event.target.value)}
                      spellCheck={false}
                    />
                    <p className={fieldDescriptionClass}>
                      The URL your requests will be sent to. Use the provider’s chat or vision endpoint.
                    </p>
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

              <section className="space-y-5 rounded-2xl border border-white/10 bg-slate-900/60 p-5">
                <div className="space-y-2">
                  <p className="text-lg font-semibold text-slate-100">Advanced / Custom configuration</p>
                  <p className="text-sm text-slate-300/80">
                    Fine-tune headers, payload mappings, rate limits, and observability. Collapse the sections you don’t need.
                  </p>
                </div>
                <div className="space-y-4">
                  <details className="rounded-2xl border border-white/10 bg-white/5 p-5" open>
                    <summary className="cursor-pointer text-base font-semibold text-slate-100">Connection</summary>
                    <div className="mt-4 grid gap-5 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-api-version">
                          API version (optional)
                        </label>
                        <Input
                          id="remote-api-version"
                          placeholder="2024-05-01"
                          value={remote.apiVersion}
                          onChange={(event) => handleRemoteChange("apiVersion", event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-auth-scheme">
                          Authentication scheme
                        </label>
                        <select
                          id="remote-auth-scheme"
                          className={selectClass}
                          value={remote.authScheme}
                          onChange={(event) => handleRemoteChange("authScheme", event.target.value as any)}
                        >
                          <option value="bearer">Bearer token</option>
                          <option value="api-key-header">API key in header</option>
                          <option value="basic">Basic auth</option>
                          <option value="none">None</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-auth-header">
                          Auth header name
                        </label>
                        <Input
                          id="remote-auth-header"
                          placeholder="Authorization"
                          value={remote.authHeaderName}
                          onChange={(event) => handleRemoteChange("authHeaderName", event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-timeout">
                          Request timeout (ms)
                        </label>
                        <Input
                          id="remote-timeout"
                          type="number"
                          min={0}
                          value={remote.requestTimeoutMs}
                          onChange={(event) => handleRemoteChange("requestTimeoutMs", Number(event.target.value) || 0)}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-proxy">
                          Proxy URL (optional)
                        </label>
                        <Input
                          id="remote-proxy"
                          placeholder="http://proxy.local:8080"
                          value={remote.proxyUrl}
                          onChange={(event) => handleRemoteChange("proxyUrl", event.target.value)}
                          spellCheck={false}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-cors">
                          CORS mode
                        </label>
                        <select
                          id="remote-cors"
                          className={selectClass}
                          value={remote.corsMode}
                          onChange={(event) => handleRemoteChange("corsMode", event.target.value as VlmCorsMode)}
                        >
                          {corsOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className={fieldLabelClass} htmlFor="remote-health">
                          Health check path
                        </label>
                        <Input
                          id="remote-health"
                          placeholder="/health"
                          value={remote.healthCheckPath}
                          onChange={(event) => handleRemoteChange("healthCheckPath", event.target.value)}
                        />
                        <p className={fieldDescriptionClass}>
                          Relative to the base URL. Leave blank to ping the base endpoint directly.
                        </p>
                      </div>
                    </div>
                    <div className="mt-6 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-200">Extra headers</span>
                        <Button type="button" variant="secondary" onClick={addHeader} className="text-xs">
                          Add header
                        </Button>
                      </div>
                      <div className="space-y-3">
                        {remote.extraHeaders.length === 0 && (
                          <p className="text-xs text-slate-400">No additional headers configured.</p>
                        )}
                        {remote.extraHeaders.map((header) => (
                          <div
                            key={header.id}
                            className="grid gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-4 md:grid-cols-[1fr_1fr_auto]"
                          >
                            <Input
                              placeholder="Header name"
                              value={header.key}
                              onChange={(event) => updateHeader(header.id, { key: event.target.value })}
                              spellCheck={false}
                            />
                            <Input
                              placeholder="Value"
                              value={header.value}
                              onChange={(event) => updateHeader(header.id, { value: event.target.value })}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              className="text-xs"
                              onClick={() => removeHeader(header.id)}
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>

                  <details className="rounded-2xl border border-white/10 bg-white/5 p-5" open>
                    <summary className="cursor-pointer text-base font-semibold text-slate-100">Capabilities</summary>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-white/20 bg-slate-900"
                          checked={remote.capabilities.chat}
                          onChange={(event) => handleCapabilityChange("chat", event.target.checked)}
                        />
                        Chat / conversational prompts
                      </label>
                      <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-white/20 bg-slate-900"
                          checked={remote.capabilities.vision}
                          onChange={(event) => handleCapabilityChange("vision", event.target.checked)}
                        />
                        Vision (image to text)
                      </label>
                      <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-white/20 bg-slate-900"
                          checked={remote.capabilities.textGeneration}
                          onChange={(event) => handleCapabilityChange("textGeneration", event.target.checked)}
                        />
                        Text generation / completion
                      </label>
                      <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-white/20 bg-slate-900"
                          checked={remote.capabilities.embeddings}
                          onChange={(event) => handleCapabilityChange("embeddings", event.target.checked)}
                        />
                        Embeddings
                      </label>
                      <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-white/20 bg-slate-900"
                          checked={remote.capabilities.functionCalling}
                          onChange={(event) => handleCapabilityChange("functionCalling", event.target.checked)}
                        />
                        Tool / function calling
                      </label>
                      <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-white/20 bg-slate-900"
                          checked={remote.capabilities.streamingSupport}
                          onChange={(event) => handleCapabilityChange("streamingSupport", event.target.checked)}
                        />
                        Streaming support
                      </label>
                      <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-white/20 bg-slate-900"
                          checked={remote.capabilities.batching}
                          onChange={(event) => handleCapabilityChange("batching", event.target.checked)}
                        />
                        Batch requests
                      </label>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-response-format">
                          Response format
                        </label>
                        <select
                          id="remote-response-format"
                          className={selectClass}
                          value={remote.capabilities.responseFormat}
                          onChange={(event) =>
                            handleCapabilityChange("responseFormat", event.target.value as VlmResponseFormat)
                          }
                        >
                          {responseFormatOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-context-tokens">
                          Max context tokens
                        </label>
                        <Input
                          id="remote-context-tokens"
                          type="number"
                          min={0}
                          value={remote.capabilities.maxContextTokens}
                          onChange={(event) => handleCapabilityChange("maxContextTokens", Number(event.target.value) || 0)}
                        />
                      </div>
                    </div>
                  </details>

                  <details className="rounded-2xl border border-white/10 bg-white/5 p-5" open>
                    <summary className="cursor-pointer text-base font-semibold text-slate-100">Inference defaults</summary>
                    <div className="mt-4 grid gap-5 md:grid-cols-2">
                      <div className="space-y-2 md:col-span-2">
                        <label className={fieldLabelClass} htmlFor="remote-system-prompt">
                          System prompt
                        </label>
                        <textarea
                          id="remote-system-prompt"
                          className={textareaClass}
                          rows={4}
                          value={remote.defaults.systemPrompt}
                          onChange={(event) => handleDefaultChange("systemPrompt", event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-top-p">
                          Top-p
                        </label>
                        <Input
                          id="remote-top-p"
                          type="number"
                          step={0.05}
                          value={remote.defaults.topP}
                          onChange={(event) => handleDefaultChange("topP", Number(event.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-top-k">
                          Top-k
                        </label>
                        <Input
                          id="remote-top-k"
                          type="number"
                          value={remote.defaults.topK}
                          onChange={(event) => handleDefaultChange("topK", Number(event.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-repetition">
                          Repetition penalty
                        </label>
                        <Input
                          id="remote-repetition"
                          type="number"
                          step={0.05}
                          value={remote.defaults.repetitionPenalty}
                          onChange={(event) => handleDefaultChange("repetitionPenalty", Number(event.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-seed">
                          Seed (optional)
                        </label>
                        <Input
                          id="remote-seed"
                          type="number"
                          value={remote.defaults.seed ?? ""}
                          onChange={(event) =>
                            handleDefaultChange(
                              "seed",
                              event.target.value.trim() === "" ? null : Number(event.target.value) || null,
                            )
                          }
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className={fieldLabelClass} htmlFor="remote-stop">
                          Stop sequences (one per line)
                        </label>
                        <textarea
                          id="remote-stop"
                          className={textareaClass}
                          rows={3}
                          value={remote.defaults.stopSequences.join("\n")}
                          onChange={(event) => handleDefaultChange("stopSequences", event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-tool-policy">
                          Tool invocation policy
                        </label>
                        <select
                          id="remote-tool-policy"
                          className={selectClass}
                          value={remote.defaults.toolInvocation}
                          onChange={(event) =>
                            handleDefaultChange("toolInvocation", event.target.value as VlmToolInvocationPolicy)
                          }
                        >
                          {toolPolicyOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-json-mode">
                          JSON mode
                        </label>
                        <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
                          <input
                            id="remote-json-mode"
                            type="checkbox"
                            className="h-4 w-4 rounded border-white/20 bg-slate-900"
                            checked={remote.defaults.jsonMode}
                            onChange={(event) => handleDefaultChange("jsonMode", event.target.checked)}
                          />
                          Enforce JSON-formatted responses
                        </label>
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className={fieldLabelClass} htmlFor="remote-json-schema">
                          JSON schema (optional)
                        </label>
                        <textarea
                          id="remote-json-schema"
                          className={textareaClass}
                          rows={4}
                          value={remote.defaults.jsonSchema}
                          onChange={(event) => handleDefaultChange("jsonSchema", event.target.value)}
                        />
                      </div>
                    </div>
                  </details>

                  <details className="rounded-2xl border border-white/10 bg-white/5 p-5" open>
                    <summary className="cursor-pointer text-base font-semibold text-slate-100">Limits & retries</summary>
                    <div className="mt-4 grid gap-5 md:grid-cols-3">
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-rpm">
                          Requests / minute
                        </label>
                        <Input
                          id="remote-rpm"
                          type="number"
                          value={remote.rateLimits.rpm ?? ""}
                          onChange={(event) => handleRateLimitChange("rpm", event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-tpm">
                          Tokens / minute
                        </label>
                        <Input
                          id="remote-tpm"
                          type="number"
                          value={remote.rateLimits.tpm ?? ""}
                          onChange={(event) => handleRateLimitChange("tpm", event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-concurrency">
                          Max concurrency
                        </label>
                        <Input
                          id="remote-concurrency"
                          type="number"
                          value={remote.rateLimits.concurrency ?? ""}
                          onChange={(event) => handleRateLimitChange("concurrency", event.target.value)}
                        />
                      </div>
                    </div>
                    <div className="mt-6 grid gap-5 md:grid-cols-3">
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-retry-max">
                          Max retries
                        </label>
                        <Input
                          id="remote-retry-max"
                          type="number"
                          min={0}
                          value={remote.retryPolicy.maxRetries}
                          onChange={(event) => handleRetryChange("maxRetries", event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-retry-strategy">
                          Retry strategy
                        </label>
                        <select
                          id="remote-retry-strategy"
                          className={selectClass}
                          value={remote.retryPolicy.strategy}
                          onChange={(event) => handleRetryChange("strategy", event.target.value as VlmRetryStrategy)}
                        >
                          {retryStrategyOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-retry-delay">
                          Initial delay (ms)
                        </label>
                        <Input
                          id="remote-retry-delay"
                          type="number"
                          min={0}
                          value={remote.retryPolicy.initialDelayMs}
                          onChange={(event) => handleRetryChange("initialDelayMs", event.target.value)}
                        />
                      </div>
                    </div>
                    <div className="mt-6 grid gap-5 md:grid-cols-3">
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-breaker-failures">
                          Circuit breaker failures
                        </label>
                        <Input
                          id="remote-breaker-failures"
                          type="number"
                          min={0}
                          value={remote.circuitBreaker.failureThreshold}
                          onChange={(event) => handleCircuitChange("failureThreshold", event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-breaker-window">
                          Failure window (s)
                        </label>
                        <Input
                          id="remote-breaker-window"
                          type="number"
                          min={0}
                          value={remote.circuitBreaker.windowSeconds}
                          onChange={(event) => handleCircuitChange("windowSeconds", event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-breaker-reset">
                          Reset after (s)
                        </label>
                        <Input
                          id="remote-breaker-reset"
                          type="number"
                          min={0}
                          value={remote.circuitBreaker.resetSeconds}
                          onChange={(event) => handleCircuitChange("resetSeconds", event.target.value)}
                        />
                      </div>
                    </div>
                  </details>

                  <details className="rounded-2xl border border-white/10 bg-white/5 p-5">
                    <summary className="cursor-pointer text-base font-semibold text-slate-100">Parameter mapping</summary>
                    <div className="mt-4 space-y-4">
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-body-template">
                          Body template
                        </label>
                        <textarea
                          id="remote-body-template"
                          className={textareaClass}
                          rows={4}
                          value={remote.parameterMapping.bodyTemplate}
                          onChange={(event) => handleParameterMappingChange("bodyTemplate", event.target.value)}
                        />
                        <p className={advancedHintClass}>
                          Variables available: {"{{prompt}}, {{messages}}, {{temperature}}, {{maxTokens}}, {{model}}, etc."}
                        </p>
                      </div>
                      {([
                        ["responseTextPath", "Response text path"],
                        ["promptTokensPath", "Prompt tokens path"],
                        ["completionTokensPath", "Completion tokens path"],
                        ["totalTokensPath", "Total tokens path"],
                        ["finishReasonPath", "Finish reason path"],
                        ["toolCallPath", "Tool call path"],
                      ] as Array<[keyof VlmSettings["remote"]["parameterMapping"], string]>).map(([key, label]) => (
                        <div className="space-y-2" key={key}>
                          <label className={fieldLabelClass} htmlFor={`remote-${key}`}>
                            {label}
                          </label>
                          <Input
                            id={`remote-${key}`}
                            value={remote.parameterMapping[key]}
                            onChange={(event) => handleParameterMappingChange(key, event.target.value)}
                          />
                        </div>
                      ))}
                    </div>
                  </details>

                  <details className="rounded-2xl border border-white/10 bg-white/5 p-5">
                    <summary className="cursor-pointer text-base font-semibold text-slate-100">Privacy & observability</summary>
                    <div className="mt-4 grid gap-5 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-logging">
                          Prompt logging
                        </label>
                        <select
                          id="remote-logging"
                          className={selectClass}
                          value={remote.logging.promptLogging}
                          onChange={(event) => handleLoggingChange("promptLogging", event.target.value as VlmPromptLoggingLevel)}
                        >
                          {loggingOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-persist">
                          Persist responses
                        </label>
                        <select
                          id="remote-persist"
                          className={selectClass}
                          value={remote.logging.persistResponses}
                          onChange={(event) =>
                            handleLoggingChange("persistResponses", event.target.value as VlmResponsePersistence)
                          }
                        >
                          {persistenceOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-white/20 bg-slate-900"
                          checked={remote.logging.piiRedaction}
                          onChange={(event) => handleLoggingChange("piiRedaction", event.target.checked)}
                        />
                        Enable PII redaction on stored prompts
                      </label>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-data-residency">
                          Data residency note
                        </label>
                        <Input
                          id="remote-data-residency"
                          value={remote.logging.dataResidencyNote}
                          onChange={(event) => handleLoggingChange("dataResidencyNote", event.target.value)}
                        />
                      </div>
                    </div>
                    <div className="mt-6 grid gap-5 md:grid-cols-3">
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-input-price">
                          Input price / 1K tokens
                        </label>
                        <Input
                          id="remote-input-price"
                          type="number"
                          min={0}
                          step={0.0001}
                          value={remote.logging.costTracking.inputPrice}
                          onChange={(event) =>
                            handleLoggingChange("costTracking", { inputPrice: Math.max(0, Number(event.target.value) || 0) })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-output-price">
                          Output price / 1K tokens
                        </label>
                        <Input
                          id="remote-output-price"
                          type="number"
                          min={0}
                          step={0.0001}
                          value={remote.logging.costTracking.outputPrice}
                          onChange={(event) =>
                            handleLoggingChange("costTracking", { outputPrice: Math.max(0, Number(event.target.value) || 0) })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-currency">
                          Currency
                        </label>
                        <Input
                          id="remote-currency"
                          value={remote.logging.costTracking.currency}
                          onChange={(event) =>
                            handleLoggingChange("costTracking", { currency: event.target.value.toUpperCase() })
                          }
                        />
                      </div>
                    </div>
                  </details>

                  <details className="rounded-2xl border border-white/10 bg-white/5 p-5">
                    <summary className="cursor-pointer text-base font-semibold text-slate-100">OCR-specific preferences</summary>
                    <div className="mt-4 grid gap-5 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-input-limit">
                          Input character limit
                        </label>
                        <Input
                          id="remote-input-limit"
                          type="number"
                          min={1}
                          value={remote.ocr.inputLimitChars}
                          onChange={(event) => handleOcrChange("inputLimitChars", event.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-chunking">
                          Chunking strategy
                        </label>
                        <select
                          id="remote-chunking"
                          className={selectClass}
                          value={remote.ocr.chunkingStrategy}
                          onChange={(event) => handleOcrChange("chunkingStrategy", event.target.value as VlmChunkingStrategy)}
                        >
                          {chunkingOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-image-mode">
                          Image handling
                        </label>
                        <select
                          id="remote-image-mode"
                          className={selectClass}
                          value={remote.ocr.imageHandling}
                          onChange={(event) => handleOcrChange("imageHandling", event.target.value as VlmImageHandlingMode)}
                        >
                          {imageHandlingOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className={fieldLabelClass} htmlFor="remote-max-image">
                          Max image size (MB)
                        </label>
                        <Input
                          id="remote-max-image"
                          type="number"
                          min={1}
                          value={remote.ocr.maxImageSizeMb}
                          onChange={(event) => handleOcrChange("maxImageSizeMb", event.target.value)}
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className={fieldLabelClass} htmlFor="remote-formats">
                          Allowed image formats
                        </label>
                        <Input
                          id="remote-formats"
                          placeholder="jpg,jpeg,png,webp"
                          value={remote.ocr.allowedImageFormats}
                          onChange={(event) => handleOcrChange("allowedImageFormats", event.target.value)}
                        />
                      </div>
                      <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-white/20 bg-slate-900"
                          checked={remote.ocr.layoutJsonExpected}
                          onChange={(event) => handleOcrChange("layoutJsonExpected", event.target.checked)}
                        />
                        Expect layout JSON in responses
                      </label>
                      <div className="space-y-2 md:col-span-2">
                        <label className={fieldLabelClass} htmlFor="remote-post-process">
                          Post-processing template
                        </label>
                        <textarea
                          id="remote-post-process"
                          className={textareaClass}
                          rows={4}
                          value={remote.ocr.postProcessingTemplate}
                          onChange={(event) => handleOcrChange("postProcessingTemplate", event.target.value)}
                        />
                        <p className={advancedHintClass}>
                          Appends to every prompt to enforce response formatting for downstream OCR consumers.
                        </p>
                      </div>
                    </div>
                  </details>
                </div>
              </section>
            </>
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
