import { NextResponse } from 'next/server';
import { resolveItemCode } from '@/lib/db';
import { getMap } from '@/lib/mapService';
import { publishMapReady } from '@/lib/events';

export async function GET(
  req: Request,
  { params }: { params: { code: string } },
) {
  const { code } = params;
  const resolved = resolveItemCode(code);
  if (!resolved) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }
  const { floor, section } = resolved;
  const map = getMap(floor, section);
  if (!map) {
    return NextResponse.json({ error: 'Map not found' }, { status: 404 });
  }
  const { meta } = map;
  const mapKey = meta.key;
  // Publish event (async but don't block response)
  publishMapReady({
    item_code: code,
    floor,
    section,
    map_key: mapKey,
    checksum: meta.checksum,
  }).catch((err) => console.warn('Failed to publish MapReady event', err));
  return NextResponse.json({ floor, section, mapKey, checksum: meta.checksum });
}