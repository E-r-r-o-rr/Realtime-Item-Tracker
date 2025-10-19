import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import crypto from 'crypto';

import { createFloorMap, listFloorMaps, listFloorMapsWithPoints } from '@/lib/db';

const toClientMap = (map: ReturnType<typeof listFloorMaps>[number]) => ({
  ...map,
  imageUrl: `/api/floor-maps/${map.id}/image`,
});

export async function GET(request: NextRequest) {
  const includePoints = request.nextUrl.searchParams.get('includePoints') === 'true';
  if (includePoints) {
    const maps = listFloorMapsWithPoints().map((map) => ({
      ...toClientMap(map),
      points: map.points,
    }));
    return NextResponse.json({ maps });
  }
  const maps = listFloorMaps().map(toClientMap);
  return NextResponse.json({ maps });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const nameValue = formData.get('name');
    const floorValue = formData.get('floor');
    const widthValue = formData.get('width');
    const heightValue = formData.get('height');
    const georefOriginLat = formData.get('georefOriginLat');
    const georefOriginLon = formData.get('georefOriginLon');
    const georefRotationValue = formData.get('georefRotationDeg');
    const georefScaleValue = formData.get('georefScaleMPx');

    const name = typeof nameValue === 'string' ? nameValue.trim() : '';
    const floor = typeof floorValue === 'string' ? floorValue.trim() : null;
    const width = typeof widthValue === 'string' ? Number(widthValue) : Number.NaN;
    const height = typeof heightValue === 'string' ? Number(heightValue) : Number.NaN;
    const georefRotationDeg = typeof georefRotationValue === 'string' ? Number(georefRotationValue) : Number(georefRotationValue ?? 0);
    const georefScaleMPx = typeof georefScaleValue === 'string' ? Number(georefScaleValue) : Number(georefScaleValue ?? 1);

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Map image file is required.' }, { status: 400 });
    }

    if (!name) {
      return NextResponse.json({ error: 'Map name is required.' }, { status: 400 });
    }

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return NextResponse.json({ error: 'Map dimensions must be provided.' }, { status: 400 });
    }

    const originLatValue = georefOriginLat === null || georefOriginLat === undefined || georefOriginLat === ''
      ? null
      : Number(georefOriginLat);
    const originLonValue = georefOriginLon === null || georefOriginLon === undefined || georefOriginLon === ''
      ? null
      : Number(georefOriginLon);

    if (originLatValue !== null && !Number.isFinite(originLatValue)) {
      return NextResponse.json({ error: 'Origin latitude must be numeric.' }, { status: 400 });
    }
    if (originLonValue !== null && !Number.isFinite(originLonValue)) {
      return NextResponse.json({ error: 'Origin longitude must be numeric.' }, { status: 400 });
    }
    if (!Number.isFinite(georefRotationDeg)) {
      return NextResponse.json({ error: 'Rotation must be numeric.' }, { status: 400 });
    }
    if (!Number.isFinite(georefScaleMPx) || georefScaleMPx <= 0) {
      return NextResponse.json({ error: 'Scale must be a positive number.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ext = (file.name?.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const filename = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const mapsDir = path.join(process.cwd(), 'data', 'maps');
    await fs.mkdir(mapsDir, { recursive: true });
    await fs.writeFile(path.join(mapsDir, filename), buffer);

    const map = createFloorMap({
      name,
      floor,
      imagePath: path.join('maps', filename),
      width,
      height,
      georefOriginLat: originLatValue,
      georefOriginLon: originLonValue,
      georefRotationDeg,
      georefScaleMPx,
    });

    return NextResponse.json({ map: { ...toClientMap(map), points: [] } }, { status: 201 });
  } catch (error: any) {
    console.error('Failed to create floor map', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

