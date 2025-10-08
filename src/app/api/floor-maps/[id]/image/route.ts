import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { getFloorMapById } from '@/lib/db';

const DATA_DIR = path.join(process.cwd(), 'data', 'maps');
const PUBLIC_DIR = path.join(process.cwd(), 'public', 'maps');

const resolveImagePath = (fileName: string) => {
  const dataPath = path.join(DATA_DIR, fileName);
  if (fs.existsSync(dataPath)) return dataPath;
  const publicPath = path.join(PUBLIC_DIR, fileName);
  if (fs.existsSync(publicPath)) return publicPath;
  return null;
};

const lookupContentType = (fileName: string) => {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.svg':
      return 'image/svg+xml';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      return 'image/png';
  }
};

export function GET(_: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'Invalid map id' }, { status: 400 });
  }
  const map = getFloorMapById(id);
  if (!map) {
    return NextResponse.json({ error: 'Map not found' }, { status: 404 });
  }
  const filePath = resolveImagePath(map.image_path);
  if (!filePath) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  }
  const buffer = fs.readFileSync(filePath);
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': lookupContentType(map.image_path),
      'Cache-Control': 'no-store',
    },
  });
}
