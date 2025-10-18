import { NextRequest, NextResponse } from 'next/server';

const MESSAGE =
  'Point search has been retired. Use the live buffer destinations to reference floor map coordinates.';

export function GET(_: NextRequest) {
  return NextResponse.json({ error: MESSAGE }, { status: 410 });
}

