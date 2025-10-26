import { NextResponse } from 'next/server';
import {
  clearStorageAndBookings,
  listBookings,
  listStorage,
  seedStorageSamples,
  upsertStorageRecord,
} from '@/lib/db';
import { toClientBooking, toClientStorage } from './transform';

const REQUIRED_FIELDS = [
  'destination',
  'itemName',
  'trackingId',
  'truckNumber',
  'shipDate',
  'expectedDepartureTime',
] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const normalizePayload = (input: Record<string, unknown>) => {
  const payload: Record<RequiredField, string> = {
    destination: '',
    itemName: '',
    trackingId: '',
    truckNumber: '',
    shipDate: '',
    expectedDepartureTime: '',
  };
  for (const key of REQUIRED_FIELDS) {
    const value = input[key];
    if (!isNonEmptyString(value)) {
      throw new Error(`Missing required field: ${key}`);
    }
    payload[key] = value.trim();
  }
  const originCandidate = isNonEmptyString(input.originLocation)
    ? input.originLocation
    : isNonEmptyString(input.origin)
    ? input.origin
    : '';
  if (!originCandidate) {
    throw new Error('Missing required field: originLocation');
  }
  return {
    ...payload,
    originLocation: originCandidate.trim(),
  };
};

const serializeLists = () => {
  const storage = listStorage();
  const bookings = listBookings();
  return NextResponse.json({
    storage: storage.map(toClientStorage),
    bookings: bookings.map(toClientBooking),
  });
};

export async function GET() {
  let storage = listStorage();
  if (storage.length === 0) {
    storage = seedStorageSamples();
  }
  const bookings = listBookings();
  return NextResponse.json({
    storage: storage.map(toClientStorage),
    bookings: bookings.map(toClientBooking),
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body && body.action === 'seed') {
      const count =
        typeof body.count === 'number' && Number.isFinite(body.count)
          ? Math.max(1, Math.min(50, Math.floor(body.count)))
          : 15;
      const storage = seedStorageSamples(count);
      const bookings = listBookings();
      return NextResponse.json({
        storage: storage.map(toClientStorage),
        bookings: bookings.map(toClientBooking),
      });
    }
    const payload = normalizePayload(body ?? {});
    const booked = typeof body.booked === 'boolean' ? body.booked : false;
    const record = upsertStorageRecord({ ...payload, booked });
    const bookings = listBookings();
    return NextResponse.json(
      {
        storage: toClientStorage(record),
        bookings: bookings.map(toClientBooking),
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Unexpected error writing storage record', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE() {
  clearStorageAndBookings();
  return serializeLists();
}
