import { NextResponse } from 'next/server';
import { listScannedOrders } from '@/lib/warehouse';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? Math.min(Number(limitParam) || 100, 500) : 100;
  const archive = listScannedOrders(limit);
  return NextResponse.json({ archive });
}
