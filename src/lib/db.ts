import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface FloorMapRecord {
  id: number;
  destination: string;
  latitude: number;
  longitude: number;
}

export interface LogisticsFields {
  destination: string;
  itemName: string;
  trackingId: string;
  truckNumber: string;
  shipDate: string;
  expectedDepartureTime: string;
  originLocation: string;
}

export interface LiveBufferRecord extends LogisticsFields {
  id: number;
  lastSyncedAt: string;
}

export interface BookingRecord extends LogisticsFields {
  id: number;
  createdAt: string;
}

export interface StorageRecord extends LogisticsFields {
  id: number;
  booked: number;
  lastUpdated: string;
}

export interface HistoryRecord extends LogisticsFields {
  id: number;
  recordedAt: string;
}

let db: Database.Database | null = null;

const TABLE_COLUMNS = `
  destination,
  item_name,
  tracking_id,
  truck_number,
  ship_date,
  expected_departure_time,
  origin_location
`;

const toLogisticsArray = (payload: LogisticsFields) => [
  payload.destination,
  payload.itemName,
  payload.trackingId,
  payload.truckNumber,
  payload.shipDate,
  payload.expectedDepartureTime,
  payload.originLocation,
];

const mapLiveBufferRow = (row: any): LiveBufferRecord => ({
  id: row.id,
  destination: row.destination,
  itemName: row.item_name,
  trackingId: row.tracking_id,
  truckNumber: row.truck_number,
  shipDate: row.ship_date,
  expectedDepartureTime: row.expected_departure_time,
  originLocation: row.origin_location,
  lastSyncedAt: row.last_synced_at,
});

const mapBookingRow = (row: any): BookingRecord => ({
  id: row.id,
  destination: row.destination,
  itemName: row.item_name,
  trackingId: row.tracking_id,
  truckNumber: row.truck_number,
  shipDate: row.ship_date,
  expectedDepartureTime: row.expected_departure_time,
  originLocation: row.origin_location,
  createdAt: row.created_at,
});

const mapStorageRow = (row: any): StorageRecord => ({
  id: row.id,
  destination: row.destination,
  itemName: row.item_name,
  trackingId: row.tracking_id,
  truckNumber: row.truck_number,
  shipDate: row.ship_date,
  expectedDepartureTime: row.expected_departure_time,
  originLocation: row.origin_location,
  booked: row.booked,
  lastUpdated: row.last_updated,
});

const mapHistoryRow = (row: any): HistoryRecord => ({
  id: row.id,
  destination: row.destination,
  itemName: row.item_name,
  trackingId: row.tracking_id,
  truckNumber: row.truck_number,
  shipDate: row.ship_date,
  expectedDepartureTime: row.expected_departure_time,
  originLocation: row.origin_location,
  recordedAt: row.recorded_at,
});

function initDb() {
  if (db) return;
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'app.db');
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS floor_maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destination TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS live_buffer (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destination TEXT NOT NULL,
      item_name TEXT NOT NULL,
      tracking_id TEXT NOT NULL UNIQUE,
      truck_number TEXT NOT NULL,
      ship_date TEXT NOT NULL,
      expected_departure_time TEXT NOT NULL,
      origin_location TEXT NOT NULL,
      last_synced_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destination TEXT NOT NULL,
      item_name TEXT NOT NULL,
      tracking_id TEXT NOT NULL UNIQUE,
      truck_number TEXT NOT NULL,
      ship_date TEXT NOT NULL,
      expected_departure_time TEXT NOT NULL,
      origin_location TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS storage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destination TEXT NOT NULL,
      item_name TEXT NOT NULL,
      tracking_id TEXT NOT NULL UNIQUE,
      truck_number TEXT NOT NULL,
      ship_date TEXT NOT NULL,
      expected_departure_time TEXT NOT NULL,
      origin_location TEXT NOT NULL,
      booked INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destination TEXT NOT NULL,
      item_name TEXT NOT NULL,
      tracking_id TEXT NOT NULL,
      truck_number TEXT NOT NULL,
      ship_date TEXT NOT NULL,
      expected_departure_time TEXT NOT NULL,
      origin_location TEXT NOT NULL,
      recorded_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export function getDb(): Database.Database {
  initDb();
  if (!db) throw new Error('Failed to initialize database');
  return db;
}

export const listFloorMaps = (): FloorMapRecord[] => {
  const rows = getDb()
    .prepare(`SELECT * FROM floor_maps ORDER BY destination COLLATE NOCASE`)
    .all();
  return rows.map((row: any) => ({
    id: row.id,
    destination: row.destination,
    latitude: row.latitude,
    longitude: row.longitude,
  }));
};

export const createFloorMap = (payload: { destination: string; latitude: number; longitude: number }): FloorMapRecord => {
  const stmt = getDb().prepare(
    `INSERT INTO floor_maps (destination, latitude, longitude) VALUES (?, ?, ?)`
  );
  const info = stmt.run(payload.destination, payload.latitude, payload.longitude);
  return {
    id: Number(info.lastInsertRowid),
    destination: payload.destination,
    latitude: payload.latitude,
    longitude: payload.longitude,
  };
};

export const updateFloorMap = (
  id: number,
  updates: Partial<{ destination: string; latitude: number; longitude: number }>,
): FloorMapRecord | undefined => {
  const existing = getDb().prepare(`SELECT * FROM floor_maps WHERE id = ?`).get(id) as any;
  if (!existing) return undefined;
  const next = {
    destination: updates.destination ?? existing.destination,
    latitude: updates.latitude ?? existing.latitude,
    longitude: updates.longitude ?? existing.longitude,
  };
  getDb()
    .prepare(
      `UPDATE floor_maps SET destination = ?, latitude = ?, longitude = ? WHERE id = ?`
    )
    .run(next.destination, next.latitude, next.longitude, id);
  return { id, ...next };
};

export const getFloorMapById = (id: number): FloorMapRecord | undefined => {
  const row = getDb().prepare(`SELECT * FROM floor_maps WHERE id = ?`).get(id);
  if (!row) return undefined;
  return {
    id: row.id,
    destination: row.destination,
    latitude: row.latitude,
    longitude: row.longitude,
  };
};

export const listLiveBuffer = (): LiveBufferRecord[] => {
  const rows = getDb().prepare(`SELECT * FROM live_buffer ORDER BY last_synced_at DESC`).all();
  return rows.map(mapLiveBufferRow);
};

export const getLiveBufferByTrackingId = (trackingId: string): LiveBufferRecord | undefined => {
  const row = getDb()
    .prepare(`SELECT * FROM live_buffer WHERE tracking_id = ?`)
    .get(trackingId);
  return row ? mapLiveBufferRow(row) : undefined;
};

const getBookingByTrackingId = (trackingId: string): BookingRecord | undefined => {
  const row = getDb()
    .prepare(`SELECT * FROM bookings WHERE tracking_id = ?`)
    .get(trackingId);
  return row ? mapBookingRow(row) : undefined;
};

export const listBookings = (): BookingRecord[] => {
  const rows = getDb().prepare(`SELECT * FROM bookings ORDER BY created_at DESC`).all();
  return rows.map(mapBookingRow);
};

export const listStorage = (): StorageRecord[] => {
  const rows = getDb().prepare(`SELECT * FROM storage ORDER BY last_updated DESC`).all();
  return rows.map(mapStorageRow);
};

export const getStorageByTruckAndShipDate = (
  truckNumber: string,
  shipDate: string,
): StorageRecord | undefined => {
  const row = getDb()
    .prepare(`SELECT * FROM storage WHERE truck_number = ? AND ship_date = ? LIMIT 1`)
    .get(truckNumber, shipDate);
  return row ? mapStorageRow(row) : undefined;
};

const synchronizeBookingForStorage = (storage: StorageRecord) => {
  const database = getDb();
  if (storage.booked) {
    database
      .prepare(
        `INSERT INTO bookings (${TABLE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tracking_id) DO UPDATE SET
           destination = excluded.destination,
           item_name = excluded.item_name,
           truck_number = excluded.truck_number,
           ship_date = excluded.ship_date,
           expected_departure_time = excluded.expected_departure_time,
           origin_location = excluded.origin_location`
      )
      .run(...toLogisticsArray(storage));
  } else {
    database.prepare(`DELETE FROM bookings WHERE tracking_id = ?`).run(storage.trackingId);
  }
};

export const upsertStorageRecord = (
  payload: LogisticsFields & { booked?: boolean },
): StorageRecord => {
  const database = getDb();
  const bookedFlag = payload.booked ? 1 : 0;
  database
    .prepare(
      `INSERT INTO storage (${TABLE_COLUMNS}, booked) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tracking_id) DO UPDATE SET
         destination = excluded.destination,
         item_name = excluded.item_name,
         truck_number = excluded.truck_number,
         ship_date = excluded.ship_date,
         expected_departure_time = excluded.expected_departure_time,
         origin_location = excluded.origin_location,
         booked = excluded.booked,
         last_updated = CURRENT_TIMESTAMP`
    )
    .run(...toLogisticsArray(payload), bookedFlag);
  const row = database
    .prepare(`SELECT * FROM storage WHERE tracking_id = ?`)
    .get(payload.trackingId);
  const storage = mapStorageRow(row);
  synchronizeBookingForStorage(storage);
  return storage;
};

export const updateStorageRecord = (
  trackingId: string,
  updates: Partial<Pick<LogisticsFields, 'destination' | 'trackingId' | 'expectedDepartureTime'>> & {
    booked?: boolean;
  },
): StorageRecord | undefined => {
  const database = getDb();
  const existingRow = database
    .prepare(`SELECT * FROM storage WHERE tracking_id = ?`)
    .get(trackingId);
  if (!existingRow) return undefined;
  const existing = mapStorageRow(existingRow);
  const nextTrackingId = updates.trackingId ?? existing.trackingId;
  const trackingChanged = nextTrackingId !== existing.trackingId;
  database
    .prepare(
      `UPDATE storage SET
         destination = ?,
         tracking_id = ?,
         expected_departure_time = ?,
         booked = ?,
         last_updated = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(
      updates.destination ?? existing.destination,
      nextTrackingId,
      updates.expectedDepartureTime ?? existing.expectedDepartureTime,
      updates.booked !== undefined ? (updates.booked ? 1 : 0) : existing.booked,
      existing.id,
    );
  if (trackingChanged) {
    database.prepare(`DELETE FROM bookings WHERE tracking_id = ?`).run(existing.trackingId);
  }
  const refreshedRow = database.prepare(`SELECT * FROM storage WHERE id = ?`).get(existing.id);
  if (!refreshedRow) return undefined;
  const storage = mapStorageRow(refreshedRow);
  synchronizeBookingForStorage(storage);
  return storage;
};

export const appendHistoryRecord = (payload: LogisticsFields): HistoryRecord => {
  const stmt = getDb().prepare(
    `INSERT INTO history (${TABLE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(...toLogisticsArray(payload));
  const row = getDb()
    .prepare(`SELECT * FROM history WHERE id = ?`)
    .get(Number(info.lastInsertRowid));
  return mapHistoryRow(row);
};

export const listHistory = (): HistoryRecord[] => {
  const rows = getDb().prepare(`SELECT * FROM history ORDER BY recorded_at DESC`).all();
  return rows.map(mapHistoryRow);
};

export const ingestLiveBufferEntry = (
  payload: LogisticsFields,
): { record?: LiveBufferRecord; message?: string } => {
  const booking = getBookingByTrackingId(payload.trackingId);
  if (!booking) {
    return { message: 'Booked item not found' };
  }
  const storage = getStorageByTruckAndShipDate(payload.truckNumber, payload.shipDate);
  if (!storage) {
    return { message: 'Storage entry not found for booked item' };
  }
  const database = getDb();
  database
    .prepare(
      `INSERT INTO live_buffer (${TABLE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tracking_id) DO UPDATE SET
         destination = excluded.destination,
         item_name = excluded.item_name,
         truck_number = excluded.truck_number,
         ship_date = excluded.ship_date,
         expected_departure_time = excluded.expected_departure_time,
         origin_location = excluded.origin_location,
         last_synced_at = CURRENT_TIMESTAMP`
    )
    .run(
      storage.destination,
      storage.itemName,
      storage.trackingId,
      storage.truckNumber,
      storage.shipDate,
      storage.expectedDepartureTime,
      storage.originLocation,
    );
  appendHistoryRecord(storage);
  const row = database
    .prepare(`SELECT * FROM live_buffer WHERE tracking_id = ?`)
    .get(storage.trackingId);
  return { record: mapLiveBufferRow(row) };
};

export const syncLiveBufferWithStorage = (): LiveBufferRecord[] => {
  const database = getDb();
  const rows = database.prepare(`SELECT * FROM live_buffer`).all();
  const updateStmt = database.prepare(
    `UPDATE live_buffer SET
       destination = ?,
       item_name = ?,
       tracking_id = ?,
       truck_number = ?,
       ship_date = ?,
       expected_departure_time = ?,
       origin_location = ?,
       last_synced_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  );
  for (const row of rows) {
    const storage = getStorageByTruckAndShipDate(row.truck_number, row.ship_date);
    if (storage) {
      updateStmt.run(
        storage.destination,
        storage.itemName,
        storage.trackingId,
        storage.truckNumber,
        storage.shipDate,
        storage.expectedDepartureTime,
        storage.originLocation,
        row.id,
      );
    }
  }
  return listLiveBuffer();
};

