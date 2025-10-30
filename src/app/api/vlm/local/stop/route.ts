import { NextResponse } from "next/server";

import { getLocalRunnerState, stopLocalRunner } from "@/lib/localRunner";

export const runtime = "nodejs";

const noStoreHeaders = {
  "cache-control": "no-store",
};

export async function POST() {
  try {
    const state = await stopLocalRunner();
    return NextResponse.json(
      {
        ok: state.status === "stopped",
        status: state.status,
        modelId: state.modelId,
        pid: state.pid,
        message: state.message,
        error: state.error,
      },
      { headers: noStoreHeaders },
    );
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "Failed to stop local VLM service.";
    const state = getLocalRunnerState();
    return NextResponse.json(
      { ok: false, status: state.status, error: message, message, modelId: state.modelId, pid: state.pid },
      { status: 500, headers: noStoreHeaders },
    );
  }
}
