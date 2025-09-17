import { NextResponse } from 'next/server';
import { getCurrentScan } from '@/lib/warehouse';

export async function GET() {
  const currentScan = getCurrentScan();
  return NextResponse.json({ currentScan });
}
