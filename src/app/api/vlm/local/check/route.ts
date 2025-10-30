import { NextResponse } from "next/server";

import { readJsonBody } from "@/lib/json";
import { checkLocalModelAvailability, getLocalRunnerState } from "@/lib/localRunner";
import { loadPersistedVlmSettings } from "@/lib/settingsStore";

export const runtime = "nodejs";

const noStoreHeaders = {
  "cache-control": "no-store",
};

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<{ modelId?: string }>(request, {}, "vlm-local-check");
    const settings = loadPersistedVlmSettings();
    const fallbackModel = settings.local?.modelId?.trim() || "";
    const modelId = (body.modelId ?? fallbackModel).trim();
    if (!modelId) {
      throw new Error("Model ID is required to verify the local installation.");
    }
    const state = await checkLocalModelAvailability(modelId);
    return NextResponse.json(
      { ok: true, status: state.status, modelId: state.modelId, message: state.message, installed: state.installed },
      { headers: noStoreHeaders },
    );
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "Failed to verify local model installation.";
    const state = getLocalRunnerState();
    return NextResponse.json(
      { ok: false, status: state.status, error: message, message, installed: state.installed },
      { status: 400, headers: noStoreHeaders },
    );
  }
}
