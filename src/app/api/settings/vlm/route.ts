import { NextRequest, NextResponse } from "next/server";

import { DEFAULT_VLM_SETTINGS } from "@/config/vlm";
import { readJsonBody } from "@/lib/json";
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
  saveVlmSettings(normalized);
  return NextResponse.json({ settings: normalized }, { headers: noStoreHeaders });
}

export async function POST(request: NextRequest) {
  const body = await readJsonBody<{ action?: string }>(request, { action: "reset" }, "vlm-settings-action");
  if ((body.action ?? "").toLowerCase() === "reset") {
    saveVlmSettings(DEFAULT_VLM_SETTINGS);
    return NextResponse.json({ settings: DEFAULT_VLM_SETTINGS, reset: true }, { headers: noStoreHeaders });
  }
  return NextResponse.json({ error: "Unsupported action" }, { status: 400, headers: noStoreHeaders });
}
