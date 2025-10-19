import { NextResponse } from 'next/server';
import {
  deleteStorageRecord,
  listBookings,
  listStorage,
  updateStorageRecord,
} from '@/lib/db';
import { toClientBooking, toClientStorage } from '../transform';

type RouteParams = { trackingId: string };

const resolveTrackingId = async (context: { params: Promise<RouteParams> }) => {
  const params = await context.params;
  return typeof params.trackingId === 'string' ? params.trackingId.trim() : '';
};

export async function PATCH(req: Request, context: { params: Promise<RouteParams> }) {
  const trackingId = await resolveTrackingId(context);
  if (!trackingId) {
    return NextResponse.json({ error: 'trackingId is required' }, { status: 400 });
  }
  try {
    const body = await req.json();
    const updates = {
      destination: typeof body.destination === 'string' ? body.destination.trim() : undefined,
      expectedDepartureTime:
        typeof body.expectedDepartureTime === 'string' ? body.expectedDepartureTime.trim() : undefined,
      trackingId: typeof body.newTrackingId === 'string' ? body.newTrackingId.trim() : undefined,
      booked: typeof body.booked === 'boolean' ? body.booked : undefined,
    };
    const record = updateStorageRecord(trackingId, updates);
    if (!record) {
      return NextResponse.json({ error: 'Storage record not found' }, { status: 404 });
    }
    const bookings = listBookings();
    return NextResponse.json({
      storage: toClientStorage(record),
      bookings: bookings.map(toClientBooking),
    });
  } catch (error: any) {
    console.error('Error updating storage record', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: { params: Promise<RouteParams> }) {
  const trackingId = await resolveTrackingId(context);
  if (!trackingId) {
    return NextResponse.json({ error: 'trackingId is required' }, { status: 400 });
  }
  const removed = deleteStorageRecord(trackingId);
  if (!removed) {
    return NextResponse.json({ error: 'Storage record not found' }, { status: 404 });
  }
  const storage = listStorage();
  const bookings = listBookings();
  return NextResponse.json({
    storage: storage.map(toClientStorage),
    bookings: bookings.map(toClientBooking),
  });
}
