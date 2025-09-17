import { getBookingByTrackingId, recordScan } from '@/lib/warehouse';
import type { CurrentScanRecord, OrderFields } from '@/types/warehouse';

const NORMALIZED_KEYS: Record<keyof OrderFields, string[]> = {
  destination: ['destination', 'destinationrack', 'rack', 'racknumber', 'rackno'],
  itemName: ['itemname', 'item', 'product', 'description'],
  trackingId: ['trackingid', 'tracking', 'trackingnumber', 'itemcode', 'code', 'orderid'],
  truckNumber: ['trucknumber', 'truck', 'truckid', 'vehicle'],
  shipDate: ['shipdate', 'shippingdate', 'departdate', 'date'],
  expectedDeparture: ['expecteddeparturetime', 'expecteddeparture', 'departtime', 'departuretime', 'etd'],
  origin: ['origin', 'warehouse', 'source'],
};

function sanitizeKey(key: string) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function coalesceField(kv: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    const normalized = sanitizeKey(key);
    for (const [rawKey, value] of Object.entries(kv)) {
      if (sanitizeKey(rawKey) === normalized && value) {
        return value;
      }
    }
  }
  return undefined;
}

function fillFromBooking(partial: Partial<OrderFields>): OrderFields | null {
  const trackingId = partial.trackingId;
  if (!trackingId) {
    return null;
  }
  const booking = getBookingByTrackingId(trackingId);
  if (!booking) {
    return null;
  }
  return {
    destination: partial.destination ?? booking.destination,
    itemName: partial.itemName ?? booking.itemName,
    trackingId,
    truckNumber: partial.truckNumber ?? booking.truckNumber,
    shipDate: partial.shipDate ?? booking.shipDate,
    expectedDeparture: partial.expectedDeparture ?? booking.expectedDeparture,
    origin: partial.origin ?? booking.origin,
  };
}

export function normalizeTicketData(kv: Record<string, string>): OrderFields {
  const partial: Partial<OrderFields> = {};
  for (const key of Object.keys(NORMALIZED_KEYS) as (keyof OrderFields)[]) {
    const value = coalesceField(kv, NORMALIZED_KEYS[key]);
    if (value) {
      partial[key] = value.trim();
    }
  }

  if (!partial.trackingId) {
    throw new Error('Scanned data did not include a tracking identifier.');
  }

  const filled = fillFromBooking(partial);
  if (filled) {
    return filled;
  }

  const missing = (Object.keys(NORMALIZED_KEYS) as (keyof OrderFields)[]).filter((key) => !partial[key]);
  if (missing.length > 0) {
    throw new Error(`Scanned data is missing fields: ${missing.join(', ')}`);
  }

  return partial as OrderFields;
}

export function saveScanResult(order: OrderFields): CurrentScanRecord {
  return recordScan(order);
}
