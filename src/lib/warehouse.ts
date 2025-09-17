import { getDb } from '@/lib/db';
import type {
  CurrentScanRecord,
  OrderFields,
  ScannedOrderRecord,
  StorageRecord,
} from '@/types/warehouse';

function mapOrder(row: any): OrderFields {
  return {
    destination: row.destination,
    itemName: row.item_name ?? row.itemName,
    trackingId: row.tracking_id ?? row.trackingId,
    truckNumber: row.truck_number ?? row.truckNumber,
    shipDate: row.ship_date ?? row.shipDate,
    expectedDeparture: row.expected_departure ?? row.expectedDeparture,
    origin: row.origin,
  };
}

function mapStorage(row: any): StorageRecord {
  return {
    id: row.id,
    ...mapOrder(row),
  };
}

function mapScanned(row: any): ScannedOrderRecord {
  return {
    ...mapOrder(row),
    scannedAt: row.scanned_at,
  };
}

function mapCurrentScan(row: any): CurrentScanRecord {
  const raw: ScannedOrderRecord = {
    destination: row.raw_destination ?? '',
    itemName: row.raw_item_name ?? '',
    trackingId: row.raw_tracking_id ?? '',
    truckNumber: row.raw_truck_number ?? '',
    shipDate: row.raw_ship_date ?? '',
    expectedDeparture: row.raw_expected_departure ?? '',
    origin: row.raw_origin ?? '',
    scannedAt: row.scanned_at ?? '',
  };
  const resolved: OrderFields = {
    destination: row.resolved_destination ?? raw.destination,
    itemName: row.resolved_item_name ?? raw.itemName,
    trackingId: row.resolved_tracking_id ?? raw.trackingId,
    truckNumber: row.resolved_truck_number ?? raw.truckNumber,
    shipDate: row.resolved_ship_date ?? raw.shipDate,
    expectedDeparture: row.resolved_expected_departure ?? raw.expectedDeparture,
    origin: row.resolved_origin ?? raw.origin,
  };
  return {
    raw,
    resolved,
    bookingMatch: Boolean(row.booking_match),
    bookingMessage: row.booking_message ?? '',
    storageMatch: Boolean(row.storage_match),
    storageMessage: row.storage_message ?? '',
    storageRowId: row.storage_row_id ?? null,
    lastRefreshed: row.last_refreshed ?? null,
  };
}

export function listBookings(): OrderFields[] {
  const rows = getDb()
    .prepare(`SELECT tracking_id, destination, item_name, truck_number, ship_date, expected_departure, origin FROM bookings ORDER BY ship_date, tracking_id`)
    .all();
  return rows.map(mapOrder);
}

export function getBookingByTrackingId(trackingId: string): OrderFields | undefined {
  const row = getDb()
    .prepare(`SELECT tracking_id, destination, item_name, truck_number, ship_date, expected_departure, origin FROM bookings WHERE tracking_id = ? LIMIT 1`)
    .get(trackingId);
  return row ? mapOrder(row) : undefined;
}

export function listStorage(): StorageRecord[] {
  const rows = getDb()
    .prepare(`SELECT id, destination, item_name, tracking_id, truck_number, ship_date, expected_departure, origin FROM storage ORDER BY id`)
    .all();
  return rows.map(mapStorage);
}

export function getStorageById(id: string): StorageRecord | undefined {
  const row = getDb()
    .prepare(`SELECT id, destination, item_name, tracking_id, truck_number, ship_date, expected_departure, origin FROM storage WHERE id = ? LIMIT 1`)
    .get(id);
  return row ? mapStorage(row) : undefined;
}

export function getStorageByTruckAndShip(truckNumber: string, shipDate: string): StorageRecord | undefined {
  const row = getDb()
    .prepare(`SELECT id, destination, item_name, tracking_id, truck_number, ship_date, expected_departure, origin FROM storage WHERE truck_number = ? AND ship_date = ? LIMIT 1`)
    .get(truckNumber, shipDate);
  return row ? mapStorage(row) : undefined;
}

export function updateStorageRow(
  id: string,
  updates: Partial<Pick<OrderFields, 'destination' | 'trackingId' | 'expectedDeparture'>>,
): StorageRecord | undefined {
  const database = getDb();
  const existing = getStorageById(id);
  if (!existing) return undefined;
  const destination = updates.destination ?? existing.destination;
  const trackingId = updates.trackingId ?? existing.trackingId;
  const expectedDeparture = updates.expectedDeparture ?? existing.expectedDeparture;
  database
    .prepare(
      `UPDATE storage SET destination = ?, tracking_id = ?, expected_departure = ? WHERE id = ?`,
    )
    .run(destination, trackingId, expectedDeparture, id);
  return getStorageById(id);
}

export function listScannedOrders(limit = 100): ScannedOrderRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT destination, item_name, tracking_id, truck_number, ship_date, expected_departure, origin, scanned_at FROM scanned_orders ORDER BY datetime(scanned_at) DESC LIMIT ?`,
    )
    .all(limit);
  return rows.map(mapScanned);
}

export function getCurrentScan(): CurrentScanRecord | null {
  const row = getDb().prepare(`SELECT * FROM current_scan WHERE id = 1`).get();
  if (!row || !row.scanned_at) return null;
  return mapCurrentScan(row);
}

function refreshCurrentScanInternal(database = getDb()): CurrentScanRecord | null {
  const row = database.prepare(`SELECT * FROM current_scan WHERE id = 1`).get();
  if (!row || !row.scanned_at) {
    return null;
  }
  const now = new Date().toISOString();
  const raw = mapCurrentScan(row).raw;
  let bookingMatch = 0;
  let bookingMessage = 'Booked item not found.';
  let storageMatch = 0;
  let storageMessage = 'Storage entry not found for the scanned truck and ship date.';
  let storageRowId: string | null = null;
  let resolved: OrderFields = { ...raw };

  if (raw.trackingId) {
    const booking = database
      .prepare(
        `SELECT tracking_id, destination, item_name, truck_number, ship_date, expected_departure, origin FROM bookings WHERE tracking_id = ? LIMIT 1`,
      )
      .get(raw.trackingId);
    if (booking) {
      bookingMatch = 1;
      bookingMessage = 'Booking located and verified.';
      const storage = database
        .prepare(
          `SELECT id, destination, item_name, tracking_id, truck_number, ship_date, expected_departure, origin FROM storage WHERE truck_number = ? AND ship_date = ? LIMIT 1`,
        )
        .get(raw.truckNumber, raw.shipDate);
      if (storage) {
        storageMatch = 1;
        storageMessage = `Linked to storage row ${(storage as any).id}.`;
        storageRowId = (storage as any).id;
        resolved = mapOrder(storage);
      } else {
        storageMessage = 'Storage entry not found for the scanned truck and ship date.';
      }
    } else {
      bookingMessage = 'Booked item not found in the Booking Table.';
    }
  } else {
    bookingMessage = 'Scanned ticket did not include a tracking ID.';
  }

  database
    .prepare(
      `UPDATE current_scan SET
        resolved_destination = ?,
        resolved_item_name = ?,
        resolved_tracking_id = ?,
        resolved_truck_number = ?,
        resolved_ship_date = ?,
        resolved_expected_departure = ?,
        resolved_origin = ?,
        booking_match = ?,
        booking_message = ?,
        storage_match = ?,
        storage_message = ?,
        storage_row_id = ?,
        last_refreshed = ?
      WHERE id = 1`,
    )
    .run(
      resolved.destination,
      resolved.itemName,
      resolved.trackingId,
      resolved.truckNumber,
      resolved.shipDate,
      resolved.expectedDeparture,
      resolved.origin,
      bookingMatch,
      bookingMessage,
      storageMatch,
      storageMessage,
      storageRowId,
      now,
    );

  const updated = database.prepare(`SELECT * FROM current_scan WHERE id = 1`).get();
  return updated ? mapCurrentScan(updated) : null;
}

export function refreshCurrentScan(): CurrentScanRecord | null {
  return refreshCurrentScanInternal();
}

export function recordScan(order: OrderFields): CurrentScanRecord {
  const database = getDb();
  const now = new Date().toISOString();
  const tx = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO scanned_orders (destination, item_name, tracking_id, truck_number, ship_date, expected_departure, origin, scanned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        order.destination,
        order.itemName,
        order.trackingId,
        order.truckNumber,
        order.shipDate,
        order.expectedDeparture,
        order.origin,
        now,
      );

    database
      .prepare(
        `INSERT INTO current_scan (
          id,
          raw_destination,
          raw_item_name,
          raw_tracking_id,
          raw_truck_number,
          raw_ship_date,
          raw_expected_departure,
          raw_origin,
          resolved_destination,
          resolved_item_name,
          resolved_tracking_id,
          resolved_truck_number,
          resolved_ship_date,
          resolved_expected_departure,
          resolved_origin,
          scanned_at,
          booking_match,
          booking_message,
          storage_match,
          storage_message,
          storage_row_id,
          last_refreshed
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'Pending validation…', 0, 'Pending validation…', NULL, ?)
        ON CONFLICT(id) DO UPDATE SET
          raw_destination = excluded.raw_destination,
          raw_item_name = excluded.raw_item_name,
          raw_tracking_id = excluded.raw_tracking_id,
          raw_truck_number = excluded.raw_truck_number,
          raw_ship_date = excluded.raw_ship_date,
          raw_expected_departure = excluded.raw_expected_departure,
          raw_origin = excluded.raw_origin,
          resolved_destination = excluded.resolved_destination,
          resolved_item_name = excluded.resolved_item_name,
          resolved_tracking_id = excluded.resolved_tracking_id,
          resolved_truck_number = excluded.resolved_truck_number,
          resolved_ship_date = excluded.resolved_ship_date,
          resolved_expected_departure = excluded.resolved_expected_departure,
          resolved_origin = excluded.resolved_origin,
          scanned_at = excluded.scanned_at,
          booking_match = excluded.booking_match,
          booking_message = excluded.booking_message,
          storage_match = excluded.storage_match,
          storage_message = excluded.storage_message,
          storage_row_id = excluded.storage_row_id,
          last_refreshed = excluded.last_refreshed`,
      )
      .run(
        order.destination,
        order.itemName,
        order.trackingId,
        order.truckNumber,
        order.shipDate,
        order.expectedDeparture,
        order.origin,
        order.destination,
        order.itemName,
        order.trackingId,
        order.truckNumber,
        order.shipDate,
        order.expectedDeparture,
        order.origin,
        now,
        now,
      );

    return refreshCurrentScanInternal(database);
  });

  const result = tx();
  if (!result) {
    throw new Error('Failed to record scan');
  }
  return result;
}
