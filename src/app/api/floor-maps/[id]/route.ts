import { NextRequest, NextResponse } from 'next/server';
import { getFloorMapById, listMapPoints, updateFloorMap } from '@/lib/db';

const parseNumber = (value: unknown): number | null => {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  return null;
};

const serializeMap = (map: ReturnType<typeof getFloorMapById>) => {
  if (!map) return null;
  return {
    ...map,
    image_url: `/api/floor-maps/${map.id}/image`,
  };
};

export function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid map id' }, { status: 400 });
  }
  const map = getFloorMapById(id);
  if (!map) {
    return NextResponse.json({ error: 'Map not found' }, { status: 404 });
  }
  const points = listMapPoints(id);
  return NextResponse.json({ map: serializeMap(map), points });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid map id' }, { status: 400 });
  }
  const payload = await request.json();
  const updated = updateFloorMap(id, {
    name: typeof payload.name === 'string' ? payload.name : undefined,
    floor: typeof payload.floor === 'string' ? payload.floor : undefined,
    georefOriginLat: parseNumber(payload.georef_origin_lat),
    georefOriginLon: parseNumber(payload.georef_origin_lon),
    georefRotationDeg: parseNumber(payload.georef_rotation_deg),
    georefScaleMetersPerPixel: parseNumber(payload.georef_scale_m_per_px),
  });
  if (!updated) {
    return NextResponse.json({ error: 'Map not found' }, { status: 404 });
  }
  return NextResponse.json({ map: serializeMap(updated) });
}
