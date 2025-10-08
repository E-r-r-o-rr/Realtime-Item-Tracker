import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { NextRequest, NextResponse } from 'next/server';
import { createFloorMap, listFloorMaps } from '@/lib/db';

const MAPS_DIR = path.join(process.cwd(), 'data', 'maps');

const ensureDir = () => {
  if (!fs.existsSync(MAPS_DIR)) fs.mkdirSync(MAPS_DIR, { recursive: true });
};

const parseNumber = (value: FormDataEntryValue | null): number | null => {
  if (value == null) return null;
  const str = typeof value === 'string' ? value.trim() : String(value);
  if (!str) return null;
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
};

const serializeMap = (map: ReturnType<typeof listFloorMaps>[number]) => ({
  ...map,
  image_url: `/api/floor-maps/${map.id}/image`,
});

export async function GET() {
  const maps = listFloorMaps();
  return NextResponse.json({ maps: maps.map(serializeMap) });
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get('image');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Image file is required.' }, { status: 400 });
  }
  const name = (formData.get('name') as string | null)?.trim() || file.name || 'Uploaded Map';
  const floor = (formData.get('floor') as string | null)?.trim() || 'floor-1';
  const rotation = parseNumber(formData.get('georef_rotation_deg'));
  const originLat = parseNumber(formData.get('georef_origin_lat'));
  const originLon = parseNumber(formData.get('georef_origin_lon'));
  const scale = parseNumber(formData.get('georef_scale_m_per_px'));

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  ensureDir();
  const ext = path.extname(file.name || 'map.png') || '.png';
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const filePath = path.join(MAPS_DIR, filename);
  fs.writeFileSync(filePath, buffer);
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  const map = createFloorMap({
    name,
    imagePath: filename,
    width,
    height,
    georefOriginLat: originLat,
    georefOriginLon: originLon,
    georefRotationDeg: rotation,
    georefScaleMetersPerPixel: scale,
    floor,
  });

  return NextResponse.json({ map: serializeMap({ ...map, point_count: 0 }) }, { status: 201 });
}
