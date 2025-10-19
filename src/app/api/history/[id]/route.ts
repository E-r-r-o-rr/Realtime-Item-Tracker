import { NextRequest, NextResponse } from 'next/server';
import { deleteHistoryEntry } from '@/lib/db';

export async function DELETE(_req: NextRequest, context: any) {
  const idParam = context?.params?.id;
  const numericId = Number(idParam);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return NextResponse.json({ error: 'Invalid history id' }, { status: 400 });
  }
  const deleted = deleteHistoryEntry(numericId);
  if (!deleted) {
    return NextResponse.json({ error: 'History entry not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
