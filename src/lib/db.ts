import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface FloorMapRecord {
  id: number;
  name: string;
  floor: string | null;
  destinationTag: string | null;
  imagePath: string;
  width: number;
  height: number;
  georefOriginLat: number | null;
  georefOriginLon: number | null;
  georefRotationDeg: number;
  georefScaleMPx: number;
  createdAt: string;
  updatedAt: string;
}

export interface MapPointRecord {
  id: number;
  mapId: number;
  label: string;
  synonyms: string[];
  xPx: number;
  yPx: number;
  lat: number;
  lon: number;
  createdAt: string;
  updatedAt: string;
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
  scanId: string;
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
  scanId: row.scan_id,
  destination: row.destination,
  itemName: row.item_name,
  trackingId: row.tracking_id,
  truckNumber: row.truck_number,
  shipDate: row.ship_date,
  expectedDepartureTime: row.expected_departure_time,
  originLocation: row.origin_location,
  recordedAt: row.recorded_at,
});

const SAMPLE_DESTINATIONS = [
  'R1-A',
  'R2-B',
  'R3-C',
  'R4-A',
  'R5-D',
  'R6-F',
  'R2-A',
  'R1-C',
  'R7-B',
  'R8-A',
  'R9-D',
  'R10-C',
  'R11-A',
  'R12-B',
  'R13-C',
];

const SAMPLE_PRODUCTS = [
  'Widget Alpha',
  'Widget Beta',
  'Gizmo Max',
  'Gizmo Mini',
  'Box Small',
  'Box Large',
  'Crate A',
  'Crate B',
  'Bag Red',
  'Bag Blue',
];

const SAMPLE_ORIGINS = ['Dock 1', 'Dock 2', 'Dock 3', 'Inbound A', 'Inbound B'];

function initDb() {
  if (db) return;
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'app.db');
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  ensureFloorMapSchema(db);
  ensureHistorySchema(db);
  db.exec(`
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
      scan_id TEXT NOT NULL UNIQUE,
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

function ensureFloorMapSchema(database: Database.Database) {
  const existingColumns = database.prepare(`PRAGMA table_info(floor_maps)`).all() as Array<{ name: string }>;
  const hasLegacySchema = existingColumns.length > 0 && existingColumns.every((col) => [
      'id',
      'destination',
      'latitude',
      'longitude',
    ].includes(col.name));
  const hasDestinationTagColumn = existingColumns.some((col) => col.name === 'destination_tag');

  if (hasLegacySchema) {
    database.exec(`DROP TABLE IF EXISTS floor_maps`);
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS floor_maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      floor TEXT,
      destination_tag TEXT,
      image_path TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      georef_origin_lat REAL,
      georef_origin_lon REAL,
      georef_rotation_deg REAL NOT NULL DEFAULT 0,
      georef_scale_m_per_px REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS map_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      map_id INTEGER NOT NULL REFERENCES floor_maps(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      synonyms TEXT NOT NULL DEFAULT '[]',
      x_px REAL NOT NULL,
      y_px REAL NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_map_points_label ON map_points(label);
    CREATE INDEX IF NOT EXISTS idx_map_points_map_label ON map_points(map_id, label);
  `);

  if (!hasLegacySchema && existingColumns.length > 0 && !hasDestinationTagColumn) {
    database.exec(`ALTER TABLE floor_maps ADD COLUMN destination_tag TEXT`);
  }
}

const generateScanId = (seed?: number) => {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return `SCAN-${String(seed).padStart(6, '0')}`;
  }
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SCAN-${Date.now()}-${random}`;
};

function ensureHistorySchema(database: Database.Database) {
  const columns = database.prepare(`PRAGMA table_info(history)`).all() as Array<{ name: string }>;
  if (columns.length === 0) {
    return;
  }
  const hasScanId = columns.some((column) => column.name === 'scan_id');
  if (!hasScanId) {
    database.exec(`ALTER TABLE history ADD COLUMN scan_id TEXT`);
  }
  const missingScanIds = database
    .prepare(`SELECT id FROM history WHERE scan_id IS NULL OR LENGTH(TRIM(scan_id)) = 0`)
    .all() as Array<{ id: number }>;
  if (missingScanIds.length > 0) {
    const update = database.prepare(`UPDATE history SET scan_id = ? WHERE id = ?`);
    for (const row of missingScanIds) {
      update.run(generateScanId(row.id), row.id);
    }
  }
}

const EARTH_RADIUS_M = 6_378_137;
const RAD_TO_DEG = 180 / Math.PI;

const parseSynonyms = (raw: any): string[] => {
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry)).filter((entry) => entry.trim().length > 0);
    }
  } catch (error) {
    console.warn('Failed to parse synonyms JSON', error);
  }
  return [];
};

const serializeSynonyms = (synonyms: string[] | undefined): string => {
  const list = Array.isArray(synonyms)
    ? synonyms.map((value) => value.trim()).filter((value) => value.length > 0)
    : [];
  return JSON.stringify(list);
};

const mapFloorMapRow = (row: any): FloorMapRecord => ({
  id: row.id,
  name: row.name,
  floor: row.floor ?? null,
  destinationTag: row.destination_tag ?? null,
  imagePath: row.image_path,
  width: row.width,
  height: row.height,
  georefOriginLat: row.georef_origin_lat ?? null,
  georefOriginLon: row.georef_origin_lon ?? null,
  georefRotationDeg: row.georef_rotation_deg ?? 0,
  georefScaleMPx: row.georef_scale_m_per_px ?? 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapPointRow = (row: any): MapPointRecord => ({
  id: row.id,
  mapId: row.map_id,
  label: row.label,
  synonyms: parseSynonyms(row.synonyms),
  xPx: row.x_px,
  yPx: row.y_px,
  lat: row.lat,
  lon: row.lon,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const computeLatLonForPoint = (map: FloorMapRecord, xPx: number, yPx: number) => {
  const originLat = map.georefOriginLat ?? 0;
  const originLon = map.georefOriginLon ?? 0;
  const scale = map.georefScaleMPx || 1;
  const rotationRad = ((map.georefRotationDeg ?? 0) * Math.PI) / 180;

  const eastMetersUnrotated = xPx * scale;
  const northMetersUnrotated = -yPx * scale;

  const eastMeters = eastMetersUnrotated * Math.cos(rotationRad) - northMetersUnrotated * Math.sin(rotationRad);
  const northMeters = eastMetersUnrotated * Math.sin(rotationRad) + northMetersUnrotated * Math.cos(rotationRad);

  const lat = originLat + (northMeters / EARTH_RADIUS_M) * RAD_TO_DEG;
  const lonDenominator = Math.cos((originLat * Math.PI) / 180);
  const lon = originLon + (eastMeters / (EARTH_RADIUS_M * (lonDenominator === 0 ? 1e-9 : lonDenominator))) * RAD_TO_DEG;
  return { lat, lon };
};

export function getDb(): Database.Database {
  initDb();
  if (!db) throw new Error('Failed to initialize database');
  return db;
}

export const listFloorMaps = (): FloorMapRecord[] => {
  const rows = getDb().prepare(`SELECT * FROM floor_maps ORDER BY name COLLATE NOCASE`).all();
  return rows.map(mapFloorMapRow);
};

export const listFloorMapsWithPoints = (): Array<FloorMapRecord & { points: MapPointRecord[] }> => {
  const maps = listFloorMaps();
  return maps.map((map) => ({ ...map, points: listMapPoints(map.id) }));
};

export const getFloorMapById = (id: number): FloorMapRecord | undefined => {
  const row = getDb().prepare(`SELECT * FROM floor_maps WHERE id = ?`).get(id);
  return row ? mapFloorMapRow(row) : undefined;
};

export const getFloorMapWithPoints = (id: number): (FloorMapRecord & { points: MapPointRecord[] }) | undefined => {
  const map = getFloorMapById(id);
  if (!map) return undefined;
  return { ...map, points: listMapPoints(id) };
};

export const createFloorMap = (payload: {
  name: string;
  floor?: string | null;
  destinationTag?: string | null;
  imagePath: string;
  width: number;
  height: number;
  georefOriginLat?: number | null;
  georefOriginLon?: number | null;
  georefRotationDeg?: number;
  georefScaleMPx?: number;
}): FloorMapRecord => {
  const stmt = getDb().prepare(
    `INSERT INTO floor_maps (name, floor, destination_tag, image_path, width, height, georef_origin_lat, georef_origin_lon, georef_rotation_deg, georef_scale_m_per_px)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(
    payload.name,
    payload.floor ?? null,
    payload.destinationTag ?? null,
    payload.imagePath,
    payload.width,
    payload.height,
    payload.georefOriginLat ?? null,
    payload.georefOriginLon ?? null,
    payload.georefRotationDeg ?? 0,
    payload.georefScaleMPx ?? 1,
  );
  const map = getFloorMapById(Number(info.lastInsertRowid));
  if (!map) throw new Error('Failed to create floor map');
  return map;
};

export const updateFloorMap = (
  id: number,
  updates: Partial<{
    name: string;
    floor: string | null;
    destinationTag: string | null;
    imagePath: string;
    width: number;
    height: number;
    georefOriginLat: number | null;
    georefOriginLon: number | null;
    georefRotationDeg: number;
    georefScaleMPx: number;
  }>,
): FloorMapRecord | undefined => {
  const existing = getFloorMapById(id);
  if (!existing) return undefined;

  const next = {
    name: updates.name ?? existing.name,
    floor: updates.floor === undefined ? existing.floor : updates.floor,
    destinationTag: updates.destinationTag === undefined ? existing.destinationTag : updates.destinationTag,
    imagePath: updates.imagePath ?? existing.imagePath,
    width: updates.width ?? existing.width,
    height: updates.height ?? existing.height,
    georefOriginLat: updates.georefOriginLat === undefined ? existing.georefOriginLat : updates.georefOriginLat,
    georefOriginLon: updates.georefOriginLon === undefined ? existing.georefOriginLon : updates.georefOriginLon,
    georefRotationDeg: updates.georefRotationDeg ?? existing.georefRotationDeg,
    georefScaleMPx: updates.georefScaleMPx ?? existing.georefScaleMPx,
  };

  getDb()
    .prepare(
      `UPDATE floor_maps
         SET name = ?,
             floor = ?,
             destination_tag = ?,
             image_path = ?,
             width = ?,
             height = ?,
             georef_origin_lat = ?,
             georef_origin_lon = ?,
             georef_rotation_deg = ?,
             georef_scale_m_per_px = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(
      next.name,
      next.floor ?? null,
      next.destinationTag ?? null,
      next.imagePath,
      next.width,
      next.height,
      next.georefOriginLat ?? null,
      next.georefOriginLon ?? null,
      next.georefRotationDeg,
      next.georefScaleMPx,
      id,
    );

  const map = getFloorMapById(id);
  if (!map) return undefined;

  if (
    next.georefOriginLat !== existing.georefOriginLat ||
    next.georefOriginLon !== existing.georefOriginLon ||
    next.georefRotationDeg !== existing.georefRotationDeg ||
    next.georefScaleMPx !== existing.georefScaleMPx
  ) {
    recomputeMapPointsForMap(map);
  }

  return map;
};

export const listMapPoints = (mapId: number): MapPointRecord[] => {
  const rows = getDb()
    .prepare(`SELECT * FROM map_points WHERE map_id = ? ORDER BY label COLLATE NOCASE`)
    .all(mapId);
  return rows.map(mapPointRow);
};

export const createMapPoint = (payload: {
  mapId: number;
  label: string;
  synonyms?: string[];
  xPx: number;
  yPx: number;
}): MapPointRecord => {
  const map = getFloorMapById(payload.mapId);
  if (!map) {
    throw new Error(`Map ${payload.mapId} not found`);
  }
  const { lat, lon } = computeLatLonForPoint(map, payload.xPx, payload.yPx);
  const stmt = getDb().prepare(
    `INSERT INTO map_points (map_id, label, synonyms, x_px, y_px, lat, lon) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(
    payload.mapId,
    payload.label,
    serializeSynonyms(payload.synonyms),
    payload.xPx,
    payload.yPx,
    lat,
    lon,
  );
  const row = getDb()
    .prepare(`SELECT * FROM map_points WHERE id = ?`)
    .get(Number(info.lastInsertRowid));
  if (!row) throw new Error('Failed to create point');
  return mapPointRow(row);
};

export const updateMapPoint = (
  id: number,
  updates: Partial<{ label: string; synonyms: string[]; xPx: number; yPx: number }>,
): MapPointRecord | undefined => {
  const row = getDb().prepare(`SELECT * FROM map_points WHERE id = ?`).get(id);
  if (!row) return undefined;
  const existing = mapPointRow(row);
  const map = getFloorMapById(existing.mapId);
  if (!map) {
    throw new Error(`Map ${existing.mapId} missing while updating point`);
  }
  const nextXPx = updates.xPx ?? existing.xPx;
  const nextYPx = updates.yPx ?? existing.yPx;
  const { lat, lon } = computeLatLonForPoint(map, nextXPx, nextYPx);

  getDb()
    .prepare(
      `UPDATE map_points
         SET label = ?,
             synonyms = ?,
             x_px = ?,
             y_px = ?,
             lat = ?,
             lon = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .run(
      updates.label ?? existing.label,
      serializeSynonyms(updates.synonyms ?? existing.synonyms),
      nextXPx,
      nextYPx,
      lat,
      lon,
      id,
    );

  const refreshed = getDb().prepare(`SELECT * FROM map_points WHERE id = ?`).get(id);
  return refreshed ? mapPointRow(refreshed) : undefined;
};

export const deleteMapPoint = (id: number): boolean => {
  const stmt = getDb().prepare(`DELETE FROM map_points WHERE id = ?`);
  const result = stmt.run(id);
  return result.changes > 0;
};

const recomputeMapPointsForMap = (map: FloorMapRecord) => {
  const points = listMapPoints(map.id);
  const updateStmt = getDb().prepare(
    `UPDATE map_points SET lat = ?, lon = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  );
  const tx = getDb().transaction((entries: MapPointRecord[]) => {
    for (const point of entries) {
      const { lat, lon } = computeLatLonForPoint(map, point.xPx, point.yPx);
      updateStmt.run(lat, lon, point.id);
    }
  });
  tx(points);
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

export const clearStorageAndBookings = () => {
  getDb().exec(`
    DELETE FROM live_buffer;
    DELETE FROM bookings;
    DELETE FROM storage;
  `);
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

export const getStorageByTrackingId = (trackingId: string): StorageRecord | undefined => {
  const row = getDb().prepare(`SELECT * FROM storage WHERE tracking_id = ?`).get(trackingId);
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

export const deleteStorageRecord = (trackingId: string): boolean => {
  const database = getDb();
  const info = database.prepare(`DELETE FROM storage WHERE tracking_id = ?`).run(trackingId);
  database.prepare(`DELETE FROM bookings WHERE tracking_id = ?`).run(trackingId);
  database.prepare(`DELETE FROM live_buffer WHERE tracking_id = ?`).run(trackingId);
  return info.changes > 0;
};

export const seedStorageSamples = (count = 15): StorageRecord[] => {
  clearStorageAndBookings();
  const totalOrigins = SAMPLE_ORIGINS.length;
  const totalProducts = SAMPLE_PRODUCTS.length;
  const totalDestinations = SAMPLE_DESTINATIONS.length;
  for (let i = 0; i < count; i++) {
    const payload: LogisticsFields = {
      destination: SAMPLE_DESTINATIONS[i % totalDestinations],
      itemName: SAMPLE_PRODUCTS[i % totalProducts],
      trackingId: `TRK${String(100000 + i)}`,
      truckNumber: String(200 + (i % 7)),
      shipDate: `2025-09-${String(10 + (i % 15)).padStart(2, '0')}`,
      expectedDepartureTime: `${String(8 + (i % 9)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`,
      originLocation: SAMPLE_ORIGINS[i % totalOrigins],
    };
    upsertStorageRecord({ ...payload, booked: i < Math.min(count, 10) });
  }
  return listStorage();
};

export const appendHistoryRecord = (payload: LogisticsFields): HistoryRecord => {
  const scanId = generateScanId();
  const stmt = getDb().prepare(
    `INSERT INTO history (${TABLE_COLUMNS}, scan_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(...toLogisticsArray(payload), scanId);
  const row = getDb()
    .prepare(`SELECT * FROM history WHERE id = ?`)
    .get(Number(info.lastInsertRowid));
  return mapHistoryRow(row);
};

export const listHistory = (): HistoryRecord[] => {
  const rows = getDb().prepare(`SELECT * FROM history ORDER BY recorded_at DESC`).all();
  return rows.map(mapHistoryRow);
};

export const clearHistory = (): number => {
  const info = getDb().prepare(`DELETE FROM history`).run();
  return info.changes ?? 0;
};

export const deleteHistoryEntry = (id: number): boolean => {
  const info = getDb().prepare(`DELETE FROM history WHERE id = ?`).run(id);
  return (info.changes ?? 0) > 0;
};

export const ingestLiveBufferEntry = (
  payload: LogisticsFields,
): { record?: LiveBufferRecord; historyEntry?: HistoryRecord; message?: string } => {
  const booking = getBookingByTrackingId(payload.trackingId);
  const existingStorage = getStorageByTrackingId(payload.trackingId);
  const shouldBook = booking ? true : existingStorage ? existingStorage.booked === 1 : false;
  const storage = upsertStorageRecord({ ...payload, booked: shouldBook });
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
  const historyEntry = appendHistoryRecord(storage);
  const row = database
    .prepare(`SELECT * FROM live_buffer WHERE tracking_id = ?`)
    .get(storage.trackingId);
  return { record: mapLiveBufferRow(row), historyEntry };
};

export const syncLiveBufferWithStorage = (): LiveBufferRecord[] => {
  const database = getDb();
  const rows = database.prepare(`SELECT * FROM live_buffer`).all() as any[];
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
    const storage = getStorageByTrackingId(row.tracking_id);
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

