import { NextRequest, NextResponse } from 'next/server';
import { createFloorMap, listFloorMaps } from '@/lib/db';

export async function GET() {
  const maps = listFloorMaps();
  return NextResponse.json({ maps });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const destination = typeof body.destination === 'string' ? body.destination.trim() : '';
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);

    if (!destination) {
      return NextResponse.json({ error: 'Destination is required.' }, { status: 400 });
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return NextResponse.json({ error: 'Latitude and longitude must be numeric.' }, { status: 400 });
    }

    const map = createFloorMap({ destination, latitude, longitude });
    return NextResponse.json({ map }, { status: 201 });
  } catch (error: any) {
    console.error('Failed to create floor map', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

