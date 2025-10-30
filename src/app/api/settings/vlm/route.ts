import { NextRequest, NextResponse } from "next/server";

import { DEFAULT_VLM_SETTINGS } from "@/config/vlm";
import { readJsonBody } from "@/lib/json";
import { getLocalVlmServiceStatus, stopLocalVlmService } from "@/lib/localVlmService";
import { loadPersistedVlmSettings, saveVlmSettings } from "@/lib/settingsStore";
import { normalizeVlmSettings } from "@/lib/vlmSettings";
import { VlmSettings } from "@/types/vlm";

export const runtime = "nodejs";

const noStoreHeaders = {
  "cache-control": "no-store",
};

export async function GET() {
  const settings = loadPersistedVlmSettings();
  return NextResponse.json({ settings }, { headers: noStoreHeaders });
}

export async function PUT(request: NextRequest) {
  const body = await readJsonBody<Partial<VlmSettings>>(request, {}, "vlm-settings-update");
  const normalized = normalizeVlmSettings(body);

  await maybeStopServiceForUpdate(normalized);

  saveVlmSettings(normalized);
  return NextResponse.json({ settings: normalized }, { headers: noStoreHeaders });
}

async function maybeStopServiceForUpdate(next: VlmSettings) {
  const status = getLocalVlmServiceStatus();
  if (status.state === "stopped") return;

  const desiredAttn = next.local.enableFlashAttention2 ? "flash_attention_2" : "";
  const desiredPrompt = next.remote.defaults.systemPrompt || "";

  if (next.mode !== "local") {
    await stopLocalVlmService();
    return;
  }

  if (!status.config) {
    await stopLocalVlmService();
    return;
  }

  const config = status.config;
  if (
    config.modelId !== next.local.modelId ||
    config.dtype !== next.local.dtype ||
    config.deviceMap !== next.local.deviceMap ||
    config.maxNewTokens !== next.local.maxNewTokens ||
    config.attnImpl !== desiredAttn ||
    config.systemPrompt !== desiredPrompt
  ) {
    await stopLocalVlmService();
  }
}

export async function POST(request: NextRequest) {
  const body = await readJsonBody<{ action?: string }>(request, { action: "reset" }, "vlm-settings-action");
  if ((body.action ?? "").toLowerCase() === "reset") {
    await stopLocalVlmService();
    saveVlmSettings(DEFAULT_VLM_SETTINGS);
    return NextResponse.json({ settings: DEFAULT_VLM_SETTINGS, reset: true }, { headers: noStoreHeaders });
  }
  return NextResponse.json({ error: "Unsupported action" }, { status: 400, headers: noStoreHeaders });
}
