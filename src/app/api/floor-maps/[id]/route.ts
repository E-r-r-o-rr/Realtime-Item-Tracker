import { NextRequest, NextResponse } from 'next/server';

import { getFloorMapById, getFloorMapWithPoints, updateFloorMap } from '@/lib/db';

type RouteParams = { id: string };

const parseId = async (context: { params: Promise<RouteParams> }) => {
  const { id } = await context.params;
  const numericId = Number(id);
  return Number.isFinite(numericId) ? numericId : NaN;
};

const toClientMap = (map: NonNullable<ReturnType<typeof getFloorMapById>>) => ({
  ...map,
  imageUrl: `/api/floor-maps/${map.id}/image`,
});

export async function GET(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const id = await parseId(context);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid map id' }, { status: 400 });
  }
  const includePoints = request.nextUrl.searchParams.get('includePoints') === 'true';
  const map = includePoints ? getFloorMapWithPoints(id) : getFloorMapById(id);
  if (!map) {
    return NextResponse.json({ error: 'Map not found' }, { status: 404 });
  }
  const base = toClientMap(map as NonNullable<ReturnType<typeof getFloorMapById>>);
  return NextResponse.json({ map: includePoints && 'points' in map ? { ...base, points: map.points } : base });
}

export async function PUT(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const id = await parseId(context);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid map id' }, { status: 400 });
  }
  try {
    const body = await request.json();
    const updates = {
      name: typeof body.name === 'string' ? body.name.trim() : undefined,
      floor: typeof body.floor === 'string' ? body.floor.trim() : body.floor === null ? null : undefined,
      destinationTag:
        typeof body.destinationTag === 'string'
          ? body.destinationTag.trim() || null
          : body.destinationTag === null
            ? null
            : undefined,
      georefOriginLat:
        body.georefOriginLat === null || body.georefOriginLat === undefined || body.georefOriginLat === ''
          ? null
          : Number(body.georefOriginLat),
      georefOriginLon:
        body.georefOriginLon === null || body.georefOriginLon === undefined || body.georefOriginLon === ''
          ? null
          : Number(body.georefOriginLon),
      georefRotationDeg: Number.isFinite(Number(body.georefRotationDeg)) ? Number(body.georefRotationDeg) : undefined,
      georefScaleMPx: Number.isFinite(Number(body.georefScaleMPx)) ? Number(body.georefScaleMPx) : undefined,
      width: Number.isFinite(Number(body.width)) ? Number(body.width) : undefined,
      height: Number.isFinite(Number(body.height)) ? Number(body.height) : undefined,
    } as const;
    const map = updateFloorMap(id, updates);
    if (!map) {
      return NextResponse.json({ error: 'Map not found' }, { status: 404 });
    }
    const includePoints = Boolean(body.includePoints);
    const enriched = includePoints ? getFloorMapWithPoints(id) : map;
    if (!enriched) {
      return NextResponse.json({ error: 'Map not found' }, { status: 404 });
    }
    const base = toClientMap(enriched as NonNullable<ReturnType<typeof getFloorMapById>>);
    const responsePayload = includePoints && 'points' in enriched ? { ...base, points: enriched.points } : base;
    return NextResponse.json({ map: responsePayload });
  } catch (error: any) {
    console.error('Failed to update floor map', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

