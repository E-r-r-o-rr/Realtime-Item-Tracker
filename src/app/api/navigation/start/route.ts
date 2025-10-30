import { NextRequest, NextResponse } from 'next/server';

import { readJsonBody } from '@/lib/json';

export async function POST(request: NextRequest) {
  const payload = await readJsonBody<Record<string, unknown> | null>(request, null, 'navigation payload');
  if (!payload) {
    return NextResponse.json({ error: 'Navigation payload is required' }, { status: 400 });
  }
  return NextResponse.json({ status: 'queued', received_at: new Date().toISOString(), payload });
}
