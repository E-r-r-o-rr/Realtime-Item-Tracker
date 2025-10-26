import { BookingRecord, StorageRecord } from '@/lib/db';

export const toClientStorage = (record: StorageRecord) => ({
  id: record.id,
  destination: record.destination,
  itemName: record.itemName,
  trackingId: record.trackingId,
  truckNumber: record.truckNumber,
  shipDate: record.shipDate,
  expectedDepartureTime: record.expectedDepartureTime,
  originLocation: record.originLocation,
  booked: Boolean(record.booked),
  lastUpdated: record.lastUpdated,
});

export const toClientBooking = (record: BookingRecord) => ({
  id: record.id,
  destination: record.destination,
  itemName: record.itemName,
  trackingId: record.trackingId,
  truckNumber: record.truckNumber,
  shipDate: record.shipDate,
  expectedDepartureTime: record.expectedDepartureTime,
  originLocation: record.originLocation,
  createdAt: record.createdAt,
});
