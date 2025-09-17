import { NextResponse } from 'next/server';
import { updateStorageRow } from '@/lib/warehouse';

const ALLOWED_FIELDS = new Set(['destination', 'trackingId', 'expectedDeparture']);

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = params.id;
    const body = await req.json();
    const updates: Record<string, string> = {};
    for (const [key, value] of Object.entries(body ?? {})) {
      if (ALLOWED_FIELDS.has(key) && typeof value === 'string') {
        updates[key] = value;
      }
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields provided.' }, { status: 400 });
    }
    const updated = updateStorageRow(id, updates as any);
    if (!updated) {
      return NextResponse.json({ error: 'Storage row not found.' }, { status: 404 });
    }
    return NextResponse.json({ storage: updated });
  } catch (error: any) {
    console.error('Storage update error:', error);
    return NextResponse.json({ error: 'Failed to update storage row.' }, { status: 400 });
  }
}
