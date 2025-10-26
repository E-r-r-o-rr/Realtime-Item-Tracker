import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/json";
import { loadPersistedVlmSettings } from "@/lib/settingsStore";
import { normalizeVlmSettings } from "@/lib/vlmSettings";
import { VlmSettings } from "@/types/vlm";

export const runtime = "nodejs";

const noStoreHeaders = {
  "cache-control": "no-store",
};

const fetchWithTimeout = async (url: URL, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
};

const buildHeaders = (settings: VlmSettings): HeadersInit => {
  if (settings.mode !== "remote") return {};
  const headers = new Headers();
  const remote = settings.remote;
  const headerName = remote.authHeaderName || "Authorization";
  switch (remote.authScheme) {
    case "bearer":
      if (remote.apiKey) {
        headers.set(headerName, remote.apiKey.startsWith("Bearer ") ? remote.apiKey : `Bearer ${remote.apiKey}`);
      }
      break;
    case "api-key-header":
      if (remote.apiKey) {
        headers.set(headerName, remote.apiKey);
      }
      break;
    case "basic":
      if (remote.apiKey) {
        const encoded = Buffer.from(remote.apiKey).toString("base64");
        headers.set(headerName, `Basic ${encoded}`);
      }
      break;
    default:
      break;
  }
  for (const extra of remote.extraHeaders) {
    if (extra.key && extra.value) {
      headers.set(extra.key, extra.value);
    }
  }
  return headers;
};

export async function POST(request: Request) {
  const body = await readJsonBody<{ settings?: Partial<VlmSettings> }>(request, {}, "vlm-settings-test");
  const settings = body.settings ? normalizeVlmSettings(body.settings) : loadPersistedVlmSettings();

  if (settings.mode !== "remote") {
    return NextResponse.json(
      { ok: true, mode: "local", message: "Local mode active. Remote connection not required." },
      { headers: noStoreHeaders },
    );
  }

  if (settings.remote.providerType === "huggingface") {
    if (!settings.remote.hfProvider.trim()) {
      return NextResponse.json(
        { ok: false, message: "Hugging Face provider is required. Enter the provider slug in settings." },
        { status: 400, headers: noStoreHeaders },
      );
    }
    if (!settings.remote.modelId) {
      return NextResponse.json(
        { ok: false, message: "Model ID is required for Hugging Face Inference." },
        { status: 400, headers: noStoreHeaders },
      );
    }
    if (!settings.remote.apiKey) {
      return NextResponse.json(
        { ok: false, message: "API token is required to contact Hugging Face Inference." },
        { status: 400, headers: noStoreHeaders },
      );
    }

    const modelSlug = encodeURIComponent(settings.remote.modelId);
    const provider = settings.remote.hfProvider.trim();
    const headers = new Headers();
    const token = settings.remote.apiKey.startsWith("Bearer ")
      ? settings.remote.apiKey
      : `Bearer ${settings.remote.apiKey}`;
    headers.set("Authorization", token);
    if (provider) {
      headers.set("X-Inference-Provider", provider);
    }
    for (const extra of settings.remote.extraHeaders) {
      if (extra.key && extra.value) {
        headers.set(extra.key, extra.value);
      }
    }

    const timeoutMs = Math.max(1000, settings.remote.requestTimeoutMs || 1000);
    const probeTargets = [
      new URL(`https://router.huggingface.co/status/${modelSlug}`),
      new URL(`https://router.huggingface.co/hf-inference/status/${modelSlug}`),
    ];
    let lastError: { status: number; statusText: string; ok: boolean; url: string } | null = null;
    for (const target of probeTargets) {
      if (provider) {
        target.searchParams.set("provider", provider);
      }
      try {
        const response = await fetchWithTimeout(target, { method: "GET", headers }, timeoutMs);
        const ok = response.ok;
        const message = ok
          ? `Hugging Face responded (${response.status})`
          : `Endpoint responded with status ${response.status}`;
        if (ok || target.pathname.includes("hf-inference")) {
          return NextResponse.json(
            {
              ok,
              status: response.status,
              statusText: response.statusText,
              url: target.toString(),
              message,
            },
            { headers: noStoreHeaders },
          );
        }
        lastError = {
          ok,
          status: response.status,
          statusText: response.statusText,
          url: target.toString(),
        };
      } catch (error: any) {
        const message = error?.name === "AbortError" ? "Request timed out" : "Network error";
        return NextResponse.json(
          { ok: false, message, url: target.toString() },
          { status: 502, headers: noStoreHeaders },
        );
      }
    }

    return NextResponse.json(
      {
        ok: false,
        status: lastError?.status ?? 404,
        statusText: lastError?.statusText ?? "Not Found",
        url: lastError?.url ?? probeTargets[0].toString(),
        message: "Endpoint responded with status 404",
      },
      { status: lastError?.status ?? 404, headers: noStoreHeaders },
    );
  }

  if (!settings.remote.baseUrl) {
    return NextResponse.json(
      { ok: false, message: "Base URL is required to test the remote connection." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  let target: URL;
  try {
    const base = new URL(settings.remote.baseUrl);
    const healthPath = settings.remote.healthCheckPath?.trim();
    target = healthPath ? new URL(healthPath, base) : base;
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: "Base URL is not a valid URL." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const timeoutMs = Math.max(1000, settings.remote.requestTimeoutMs || 1000);
  const headers = buildHeaders(settings);

  try {
    const response = await fetchWithTimeout(target, { method: "GET", headers }, timeoutMs);
    const ok = response.ok;
    const message = ok
      ? `Connection successful (${response.status})`
      : `Endpoint responded with status ${response.status}`;
    return NextResponse.json(
      {
        ok,
        status: response.status,
        statusText: response.statusText,
        url: target.toString(),
        message,
      },
      { headers: noStoreHeaders },
    );
  } catch (error: any) {
    const message = error?.name === "AbortError" ? "Request timed out" : "Network error";
    return NextResponse.json(
      { ok: false, message, url: target.toString() },
      { status: 502, headers: noStoreHeaders },
    );
  }
}
