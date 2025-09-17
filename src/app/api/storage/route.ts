import { NextResponse } from 'next/server';
import { listStorage } from '@/lib/warehouse';

export async function GET() {
  const storage = listStorage();
  return NextResponse.json({ storage });
}
