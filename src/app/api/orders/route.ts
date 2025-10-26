import { NextResponse } from 'next/server';
import {
  ingestLiveBufferEntry,
  listLiveBuffer,
  getLiveBufferByTrackingId,
  syncLiveBufferWithStorage,
  updateStorageRecord,
  deleteLiveBufferEntry,
  clearLiveBuffer,
  recheckBookingForLiveBuffer,
} from '@/lib/db';

const REQUIRED_FIELDS = [
  'destination',
  'itemName',
  'trackingId',
  'truckNumber',
  'shipDate',
  'expectedDepartureTime',
  'originLocation',
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
    originLocation: '',
  };
  for (const key of REQUIRED_FIELDS) {
    const value = input[key];
    if (!isNonEmptyString(value)) {
      throw new Error(`Missing required field: ${key}`);
    }
    payload[key] = value.trim();
  }
  return payload;
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const trackingId = searchParams.get('trackingId') ?? searchParams.get('code');
  const shouldSync = searchParams.get('sync') === 'true';
  const verifyBooking = searchParams.get('verifyBooking') === 'true';

  if (shouldSync) {
    syncLiveBufferWithStorage();
  }

  if (!trackingId) {
    const records = listLiveBuffer();
    return NextResponse.json({ liveBuffer: records });
  }

  const record = getLiveBufferByTrackingId(trackingId);
  if (!record) {
    return NextResponse.json({ error: 'Live buffer entry not found' }, { status: 404 });
  }

  if (verifyBooking) {
    const result = recheckBookingForLiveBuffer(trackingId);
    const responseRecord = result.record ?? record;
    const payload: Record<string, unknown> = {
      record: responseRecord,
      bookingFound: result.bookingFound,
    };
    if (result.message) {
      payload.message = result.message;
    }
    if (!result.bookingFound && result.message) {
      payload.warning = result.message;
    }
    return NextResponse.json(payload);
  }
  return NextResponse.json({ record });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const payload = normalizePayload(body ?? {});
    const result = ingestLiveBufferEntry(payload);
    return NextResponse.json(
      {
        record: result.record,
        historyEntry: result.historyEntry,
        warning: result.message,
      },
      { status: 201 },
    );
  } catch (error: any) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Unexpected error ingesting live buffer entry', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const trackingId = searchParams.get('trackingId') ?? searchParams.get('code');
    if (trackingId) {
      const removed = deleteLiveBufferEntry(trackingId);
      if (!removed) {
        return NextResponse.json({ error: 'Live buffer entry not found' }, { status: 404 });
      }
    } else {
      clearLiveBuffer();
    }
    const records = listLiveBuffer();
    return NextResponse.json({ liveBuffer: records });
  } catch (error) {
    console.error('Failed to clear live buffer', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const trackingId = typeof body.trackingId === 'string' ? body.trackingId.trim() : '';
    if (!trackingId) {
      return NextResponse.json({ error: 'trackingId is required' }, { status: 400 });
    }
    const updates = {
      destination: typeof body.destination === 'string' ? body.destination.trim() : undefined,
      trackingId: typeof body.newTrackingId === 'string' ? body.newTrackingId.trim() : undefined,
      expectedDepartureTime:
        typeof body.expectedDepartureTime === 'string' ? body.expectedDepartureTime.trim() : undefined,
      booked: typeof body.booked === 'boolean' ? body.booked : undefined,
    };
    const storage = updateStorageRecord(trackingId, updates);
    if (!storage) {
      return NextResponse.json({ error: 'Storage record not found' }, { status: 404 });
    }
    const liveBuffer = syncLiveBufferWithStorage();
    return NextResponse.json({ storage, liveBuffer });
  } catch (error: any) {
    console.error('Error updating storage record', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

