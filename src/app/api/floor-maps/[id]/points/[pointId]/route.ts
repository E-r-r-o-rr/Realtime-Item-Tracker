import { NextRequest, NextResponse } from "next/server";

import { deleteMapPoint, getFloorMapById, updateMapPoint } from "@/lib/db";

type RouteParams = { id: string; pointId: string };

const parseIds = async (context: { params: Promise<RouteParams> }) => {
  const { id, pointId } = await context.params;
  const mapId = Number(id);
  const parsedPointId = Number(pointId);
  return {
    mapId: Number.isFinite(mapId) ? mapId : NaN,
    pointId: Number.isFinite(parsedPointId) ? parsedPointId : NaN,
  };
};

export async function PUT(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const { mapId, pointId } = await parseIds(context);
  if (!Number.isFinite(mapId) || !Number.isFinite(pointId)) {
    return NextResponse.json({ error: "Invalid identifiers" }, { status: 400 });
  }
  const map = getFloorMapById(mapId);
  if (!map) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }
  try {
    const body = await request.json();
    const updates = {
      label: typeof body.label === "string" ? body.label.trim() : undefined,
      synonyms: Array.isArray(body.synonyms)
        ? body.synonyms.map((value: unknown) => String(value))
        : typeof body.synonyms === "string"
        ? body.synonyms.split(",")
        : undefined,
      xPx: body.xPx !== undefined ? Number(body.xPx) : undefined,
      yPx: body.yPx !== undefined ? Number(body.yPx) : undefined,
    };
    if (updates.xPx !== undefined && !Number.isFinite(updates.xPx)) {
      return NextResponse.json({ error: "xPx must be numeric" }, { status: 400 });
    }
    if (updates.yPx !== undefined && !Number.isFinite(updates.yPx)) {
      return NextResponse.json({ error: "yPx must be numeric" }, { status: 400 });
    }
    const point = updateMapPoint(pointId, updates);
    if (!point) {
      return NextResponse.json({ error: "Point not found" }, { status: 404 });
    }
    return NextResponse.json({ point });
  } catch (error) {
    console.error("Failed to update map point", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, context: { params: Promise<RouteParams> }) {
  const { mapId, pointId } = await parseIds(context);
  if (!Number.isFinite(mapId) || !Number.isFinite(pointId)) {
    return NextResponse.json({ error: "Invalid identifiers" }, { status: 400 });
  }
  const map = getFloorMapById(mapId);
  if (!map) {
    return NextResponse.json({ error: "Map not found" }, { status: 404 });
  }
  const removed = deleteMapPoint(pointId);
  if (!removed) {
    return NextResponse.json({ error: "Point not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
