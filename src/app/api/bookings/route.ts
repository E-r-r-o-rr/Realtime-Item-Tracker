import { NextResponse } from 'next/server';
import { listBookings } from '@/lib/warehouse';

export async function GET() {
  const bookings = listBookings();
  return NextResponse.json({ bookings });
}
