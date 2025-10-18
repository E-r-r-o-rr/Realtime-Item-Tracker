import { NextRequest, NextResponse } from 'next/server';

const MESSAGE =
  'Point-level editing is no longer available. The floor map schema now stores destination coordinates directly.';

export function GET(_: NextRequest) {
  return NextResponse.json({ error: MESSAGE }, { status: 410 });
}

export function POST(_: NextRequest) {
  return NextResponse.json({ error: MESSAGE }, { status: 410 });
}

