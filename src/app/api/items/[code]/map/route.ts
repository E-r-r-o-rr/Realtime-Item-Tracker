import { NextResponse } from 'next/server';

export function GET(_: Request, { params }: { params: { code: string } }) {
  return NextResponse.json(
    {
      error: `Map lookups by item code (${params.code}) are no longer supported. Use the floor_maps API to query coordinates directly.`,
    },
    { status: 410 },
  );
}

