import { NextRequest, NextResponse } from "next/server";

import { createMapPoint, getFloorMapById, listMapPoints } from "@/lib/db";

type RouteParams = { id: string };

const parseId = async (context: { params: Promise<RouteParams> }) => {
  const { id } = await context.params;
  const numericId = Number(id);
  return Number.isFinite(numericId) ? numericId : NaN;
};

export async function GET(_: NextRequest, context: { params: Promise<RouteParams> }) {
  const id = await parseId(context);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid map id" }, { status: 400 });
  }
  const map = getFloorMapById(id);
  if (!map) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }
  const points = listMapPoints(id);
  return NextResponse.json({ points });
}

export async function POST(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const id = await parseId(context);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid map id" }, { status: 400 });
  }
  const map = getFloorMapById(id);
  if (!map) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }
  try {
    const body = await request.json();
    const label = typeof body.label === "string" ? body.label.trim() : "";
    const xPx = Number(body.xPx);
    const yPx = Number(body.yPx);
    const synonyms = Array.isArray(body.synonyms)
      ? body.synonyms.map((value: unknown) => String(value))
      : typeof body.synonyms === "string"
      ? body.synonyms.split(",")
      : [];

    if (!label) {
      return NextResponse.json({ error: "Label is required" }, { status: 400 });
    }
    if (!Number.isFinite(xPx) || !Number.isFinite(yPx)) {
      return NextResponse.json({ error: "xPx and yPx must be numeric" }, { status: 400 });
    }

    const point = createMapPoint({ mapId: id, label, synonyms, xPx, yPx });
    return NextResponse.json({ point }, { status: 201 });
  } catch (error) {
    console.error("Failed to create map point", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
