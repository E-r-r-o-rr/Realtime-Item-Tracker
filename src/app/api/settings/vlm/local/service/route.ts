import { NextResponse } from "next/server";

import { DEFAULT_VLM_SETTINGS } from "@/config/vlm";
import { readJsonBody } from "@/lib/json";
import {
  getLocalVlmServiceStatus,
  startLocalVlmService,
  stopLocalVlmService,
} from "@/lib/localVlmService";
import { VlmLocalSettings } from "@/types/vlm";

export const runtime = "nodejs";

const noStoreHeaders = {
  "cache-control": "no-store",
};

type StartServiceBody = {
  modelId?: string;
  dtype?: string;
  deviceMap?: string;
  maxNewTokens?: number | string;
  enableFlashAttention2?: boolean;
  systemPrompt?: string;
};

const toString = (value: unknown, fallback = ""): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
};

const toNumber = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const toBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "yes", "on"].includes(normalized);
  }
  return false;
};

const normalizeLocalSettings = (body: StartServiceBody): VlmLocalSettings => {
  const base = DEFAULT_VLM_SETTINGS.local;
  return {
    modelId: toString(body.modelId, base.modelId).trim() || base.modelId,
    dtype: toString(body.dtype, base.dtype).trim() || base.dtype,
    deviceMap: toString(body.deviceMap, base.deviceMap).trim() || base.deviceMap,
    maxNewTokens: Math.max(1, toNumber(body.maxNewTokens, base.maxNewTokens)),
    enableFlashAttention2: toBoolean(body.enableFlashAttention2),
  };
};

export async function GET() {
  const status = getLocalVlmServiceStatus();
  return NextResponse.json({ ok: true, status }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  const body = await readJsonBody<StartServiceBody>(request, {}, "vlm-local-service-start");
  const local = normalizeLocalSettings(body);
  const systemPrompt = toString(body.systemPrompt, "");

  try {
    const status = await startLocalVlmService(local, systemPrompt);
    return NextResponse.json({ ok: true, status }, { headers: noStoreHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start local VLM service.";
    return NextResponse.json({ ok: false, message }, { status: 500, headers: noStoreHeaders });
  }
}

export async function DELETE() {
  const stopped = await stopLocalVlmService();
  return NextResponse.json({ ok: stopped }, { headers: noStoreHeaders });
}
