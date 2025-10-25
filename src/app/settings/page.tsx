"use client";

import { useEffect, useRef, useState } from "react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_VLM_SETTINGS,
  loadVlmSettings,
  persistVlmSettings,
  type VlmMode,
  type VlmRemoteSettings,
  type VlmSettings,
} from "@/lib/localStorage";

const modeDescriptions: Record<VlmMode, string> = {
  local:
    "Runs entirely on this workstation. Ideal for air-gapped demos or when you have GPU capacity on site.",
  remote:
    "Connects to a hosted VLM service. Recommended for production scenarios where you need elastic scale and automatic updates.",
};

const sectionTitleClass = "text-sm font-semibold uppercase tracking-wide text-slate-300";
const fieldLabelClass = "text-sm font-medium text-slate-200";
const fieldDescriptionClass = "text-xs text-slate-400";
const advancedHintClass = "text-xs text-slate-400";

const cloneSettings = (value: VlmSettings): VlmSettings => ({
  ...value,
  remote: { ...value.remote },
});

export default function SettingsPage() {
  const [settings, setSettings] = useState<VlmSettings>(() => cloneSettings(loadVlmSettings()));
  const [hydrated, setHydrated] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const statusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const stored = loadVlmSettings();
    setSettings(cloneSettings(stored));
    setHydrated(true);
  }, []);

  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
    };
  }, []);

  const showStatus = (message: string) => {
    setStatusMessage(message);
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    statusTimeoutRef.current = setTimeout(() => setStatusMessage(null), 3200);
  };

  const updateSettings = (mutator: (prev: VlmSettings) => VlmSettings) => {
    setSettings((prev) => {
      const next = mutator(prev);
      if (hydrated) {
        persistVlmSettings(next);
        showStatus("Preferences saved");
      }
      return next;
    });
  };

  const handleModeChange = (mode: VlmMode) => {
    updateSettings((prev) => ({ ...prev, mode }));
  };

  const handleRemoteChange = <K extends keyof VlmRemoteSettings>(
    key: K,
    value: VlmRemoteSettings[K],
  ) => {
    updateSettings((prev) => ({
      ...prev,
      remote: {
        ...prev.remote,
        [key]: value,
      },
    }));
  };

  const resetToDefaults = () => {
    const defaults = cloneSettings(DEFAULT_VLM_SETTINGS);
    setSettings(defaults);
    persistVlmSettings(defaults);
    showStatus("Settings reset to defaults");
  };

  const renderModeOption = (mode: VlmMode, title: string) => {
    const active = settings.mode === mode;
    return (
      <button
        type="button"
        onClick={() => handleModeChange(mode)}
        className={`flex w-full flex-col items-start gap-2 rounded-2xl border px-4 py-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
          active
            ? "border-indigo-400/60 bg-indigo-500/10 text-slate-100"
            : "border-white/10 bg-white/5 text-slate-300/80 hover:border-indigo-400/40 hover:bg-indigo-500/5"
        }`}
      >
        <span className="text-base font-semibold text-slate-100">{title}</span>
        <span className="text-sm text-slate-300/80">{modeDescriptions[mode]}</span>
      </button>
    );
  };

  const remote = settings.remote;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold text-slate-100">Settings</h1>
        <p className="text-base text-slate-300/90">
          Configure how the vision-language model (VLM) is executed and tailor the integration parameters for your deployment.
        </p>
        {statusMessage && (
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/60 bg-emerald-500/10 px-4 py-1 text-sm font-medium text-emerald-300">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden />
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
                Choose whether to run the VLM locally or through a remote API and manage related settings.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="border-white/10 bg-white/5 text-sm text-slate-200 hover:border-indigo-400/60 hover:bg-indigo-500/10"
              onClick={resetToDefaults}
            >
              Reset to defaults
            </Button>
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
              {renderModeOption("remote", "Remote service")}
              {renderModeOption("local", "Local runtime")}
            </div>
          </section>

          {settings.mode === "remote" && (
            <>
              <section className="space-y-4">
                <div className="space-y-1">
                  <p className={sectionTitleClass}>API configuration</p>
                  <p className={fieldDescriptionClass}>
                    Provide the endpoint and credentials used to reach your remote VLM instance.
                  </p>
                </div>
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className={fieldLabelClass} htmlFor="vlm-endpoint">
                      Endpoint URL
                    </label>
                    <Input
                      id="vlm-endpoint"
                      placeholder="https://api.example.com/vlm"
                      value={remote.endpointUrl}
                      onChange={(event) => handleRemoteChange("endpointUrl", event.target.value)}
                      spellCheck={false}
                    />
                    <p className={fieldDescriptionClass}>
                      Requests will be POSTed to this base URL with JSON payloads from the scanner module.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className={fieldLabelClass} htmlFor="vlm-model">
                      Model ID
                    </label>
                    <Input
                      id="vlm-model"
                      placeholder="vlm-latest"
                      value={remote.model}
                      onChange={(event) => handleRemoteChange("model", event.target.value)}
                    />
                    <p className={fieldDescriptionClass}>
                      The identifier of the deployment or checkpoint to invoke.
                    </p>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className={fieldLabelClass} htmlFor="vlm-key">
                      API key
                    </label>
                    <Input
                      id="vlm-key"
                      type="password"
                      placeholder="••••••••••"
                      value={remote.apiKey}
                      onChange={(event) => handleRemoteChange("apiKey", event.target.value)}
                    />
                    <p className={fieldDescriptionClass}>
                      Stored securely in your browser and attached as an Authorization header for outbound calls.
                    </p>
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <div className="space-y-1">
                  <p className={sectionTitleClass}>Advanced settings</p>
                  <p className={fieldDescriptionClass}>
                    Tune resilience and streaming options to match the expectations of your remote deployment.
                  </p>
                </div>
                <div className="grid gap-5 md:grid-cols-3">
                  <div className="space-y-2">
                    <label className={fieldLabelClass} htmlFor="vlm-timeout">
                      Request timeout (ms)
                    </label>
                    <Input
                      id="vlm-timeout"
                      type="number"
                      min={1000}
                      step={500}
                      value={remote.requestTimeoutMs}
                      onChange={(event) =>
                        handleRemoteChange("requestTimeoutMs", Number(event.target.value) || 0)
                      }
                    />
                    <p className={advancedHintClass}>Lower values will fail faster if the API is unreachable.</p>
                  </div>
                  <div className="space-y-2">
                    <label className={fieldLabelClass} htmlFor="vlm-retries">
                      Max retries
                    </label>
                    <Input
                      id="vlm-retries"
                      type="number"
                      min={0}
                      max={5}
                      value={remote.maxRetries}
                      onChange={(event) =>
                        handleRemoteChange("maxRetries", Math.max(0, Number(event.target.value) || 0))
                      }
                    />
                    <p className={advancedHintClass}>Retries occur on transient network errors or 5xx responses.</p>
                  </div>
                  <div className="space-y-2">
                    <span className={fieldLabelClass}>Streaming responses</span>
                    <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-white/20 bg-slate-900"
                        checked={remote.enableStreaming}
                        onChange={(event) => handleRemoteChange("enableStreaming", event.target.checked)}
                      />
                      Enable server-sent streaming for incremental tokens
                    </label>
                    <p className={advancedHintClass}>
                      Turn off if your infrastructure proxies do not support chunked responses.
                    </p>
                  </div>
                </div>
              </section>
            </>
          )}

          {settings.mode === "local" && (
            <section className="space-y-3 rounded-2xl border border-amber-400/60 bg-amber-500/10 px-5 py-4">
              <h3 className="text-base font-semibold text-amber-200">Local runtime reminder</h3>
              <p className="text-sm text-amber-100/80">
                Remember to start the local VLM service before scanning orders. The scanner will communicate with your workstation via the configured loopback ports and will not attempt any remote calls in this mode.
              </p>
            </section>
          )}
        </div>
      </Card>
    </div>
  );
}
