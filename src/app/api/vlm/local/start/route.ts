import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/json";
import { getLocalRunnerState, startLocalRunner } from "@/lib/localRunner";
import { loadPersistedVlmSettings } from "@/lib/settingsStore";

export const runtime = "nodejs";

const noStoreHeaders = {
  "cache-control": "no-store",
};

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<{ modelId?: string }>(request, {}, "vlm-local-start");
    const settings = loadPersistedVlmSettings();
    const fallbackModel = settings.local?.modelId?.trim() || "";
    const modelId = (body.modelId ?? fallbackModel).trim();
    const state = await startLocalRunner(modelId);
    return NextResponse.json(
      {
        ok: state.status === "running",
        status: state.status,
        modelId: state.modelId,
        pid: state.pid,
        message: state.message,
        error: state.error,
      },
      { headers: noStoreHeaders },
    );
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "Failed to start local VLM service.";
    const state = getLocalRunnerState();
    return NextResponse.json(
      { ok: false, status: state.status, error: message, message, modelId: state.modelId, pid: state.pid },
      { status: 400, headers: noStoreHeaders },
    );
  }
}
