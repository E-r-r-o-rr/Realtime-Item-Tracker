// src/app/api/maps/route.ts
import { NextResponse } from 'next/server';
import { getMapByKey } from '@/lib/mapService';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'missing key' }, { status: 400 });

  const result = getMapByKey(key);
  if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { buffer, meta } = result; // <- Node Buffer

  // Conditional GET
  const etag = meta.etag;
  if (req.headers.get('if-none-match') === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        'Last-Modified': meta.lastModified,
        'Cache-Control': 'public, max-age=0, must-revalidate',
      },
    });
  }

  const bytes = new Uint8Array(buffer); // ✅ make it a BodyInit-friendly type

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(bytes.byteLength),
      ETag: etag,
      'Last-Modified': meta.lastModified,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

export async function HEAD(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');
  if (!key) return new NextResponse(null, { status: 400 });

  const result = getMapByKey(key);
  if (!result) return new NextResponse(null, { status: 404 });

  const { buffer, meta } = result;
  const bytes = new Uint8Array(buffer);

  return new NextResponse(null, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(bytes.byteLength),
      ETag: meta.etag,
      'Last-Modified': meta.lastModified,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
