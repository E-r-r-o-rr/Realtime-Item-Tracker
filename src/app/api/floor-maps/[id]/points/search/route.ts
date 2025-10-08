import { NextRequest, NextResponse } from 'next/server';
import { getFloorMapById, searchMapPoint } from '@/lib/db';

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
  const label = typeof payload.label === 'string' ? payload.label : '';
  const result = searchMapPoint(mapId, label);
  return NextResponse.json({ map: { ...map, image_url: `/api/floor-maps/${map.id}/image` }, ...result });
}
