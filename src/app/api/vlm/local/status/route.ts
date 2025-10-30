import { NextResponse } from "next/server";

import { getLocalRunnerState } from "@/lib/localRunner";

export const runtime = "nodejs";

const noStoreHeaders = {
  "cache-control": "no-store",
};

export async function GET() {
  const state = getLocalRunnerState();
  return NextResponse.json(
    {
      ok: true,
      status: state.status,
      modelId: state.modelId,
      message: state.message,
      error: state.error,
      installed: state.installed,
    },
    { headers: noStoreHeaders },
  );
}
