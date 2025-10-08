import { NextRequest, NextResponse } from 'next/server';
import { createMapPoint, getFloorMapById, listMapPoints } from '@/lib/db';

export function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const mapId = Number(params.id);
  if (!Number.isFinite(mapId)) {
    return NextResponse.json({ error: 'Invalid map id' }, { status: 400 });
  }
  const map = getFloorMapById(mapId);
  if (!map) {
    return NextResponse.json({ error: 'Map not found' }, { status: 404 });
  }
  const points = listMapPoints(mapId);
  return NextResponse.json({ points });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const mapId = Number(params.id);
  if (!Number.isFinite(mapId)) {
    return NextResponse.json({ error: 'Invalid map id' }, { status: 400 });
  }
  const map = getFloorMapById(mapId);
  if (!map) {
    return NextResponse.json({ error: 'Map not found' }, { status: 404 });
  }
  const payload = await request.json();
  const label = typeof payload.label === 'string' ? payload.label.trim() : '';
  const x = Number(payload.x_px);
  const y = Number(payload.y_px);
  if (!label) {
    return NextResponse.json({ error: 'Label is required' }, { status: 400 });
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return NextResponse.json({ error: 'x_px and y_px must be numeric' }, { status: 400 });
  }
  const synonyms: string[] = Array.isArray(payload.synonyms) ? payload.synonyms : [];
  if (x < 0 || y < 0 || x > map.width || y > map.height) {
    return NextResponse.json({ error: 'Point is outside the map bounds' }, { status: 400 });
  }
  const point = createMapPoint({
    mapId,
    label,
    x_px: x,
    y_px: y,
    synonyms,
  });
  return NextResponse.json({ point }, { status: 201 });
}
