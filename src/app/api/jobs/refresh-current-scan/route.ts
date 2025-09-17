import { NextResponse } from 'next/server';
import { refreshCurrentScan } from '@/lib/warehouse';

export async function POST() {
  const currentScan = refreshCurrentScan();
  return NextResponse.json({ currentScan });
}
