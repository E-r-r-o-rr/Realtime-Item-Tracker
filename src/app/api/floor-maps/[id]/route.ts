import { NextRequest, NextResponse } from 'next/server';
import { getFloorMapById, updateFloorMap } from '@/lib/db';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid map id' }, { status: 400 });
  }
  const map = getFloorMapById(id);
  if (!map) {
    return NextResponse.json({ error: 'Map not found' }, { status: 404 });
  }
  return NextResponse.json({ map });
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid map id' }, { status: 400 });
  }
  try {
    const body = await request.json();
    const updates = {
      destination: typeof body.destination === 'string' ? body.destination.trim() : undefined,
      latitude: Number.isFinite(Number(body.latitude)) ? Number(body.latitude) : undefined,
      longitude: Number.isFinite(Number(body.longitude)) ? Number(body.longitude) : undefined,
    };
    const map = updateFloorMap(id, updates);
    if (!map) {
      return NextResponse.json({ error: 'Map not found' }, { status: 404 });
    }
    return NextResponse.json({ map });
  } catch (error: any) {
    console.error('Failed to update floor map', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

