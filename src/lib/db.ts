import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface OrderRecord {
  id: number;
  code: string;
  data: any;
  collected: number;
  floor: string;
  section: string;
  created_at: string;
  updated_at: string;
}

export interface FloorMapRecord {
  id: number;
  name: string;
  image_path: string;
  width: number;
  height: number;
  georef_origin_lat: number | null;
  georef_origin_lon: number | null;
  georef_rotation_deg: number | null;
  georef_scale_m_per_px: number | null;
  floor: string;
  created_at: string;
  updated_at: string;
}

export interface MapPointRecord {
  id: number;
  map_id: number;
  label: string;
  x_px: number;
  y_px: number;
  lat: number | null;
  lon: number | null;
  created_at: string;
  updated_at: string;
}

export interface MapPointWithSynonyms extends MapPointRecord {
  synonyms: string[];
}

export interface FloorMapSummary extends FloorMapRecord {
  point_count: number;
}

let db: Database.Database | null = null;

/**
 * Ensure the SQLite database and required tables exist. This function must be
 * called before any database operation. We use a file-based SQLite DB
 * located in the project's `data` directory for portability. SQLite is
 * well-suited for simple, file-based applications and avoids the overhead
 * of client‑server databases like PostgreSQL【575545403815759†L70-L114】.
 */
function initDb() {
  if (db) return;
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'app.db');
  db = new Database(dbPath);
  // Enable foreign keys
  db.pragma('foreign_keys = ON');
  // Create tables if they do not exist
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      data TEXT,
      collected INTEGER NOT NULL DEFAULT 0,
      floor TEXT,
      section TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS aliases (
      alias TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      FOREIGN KEY (code) REFERENCES orders(code) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS floor_maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      image_path TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      georef_origin_lat REAL,
      georef_origin_lon REAL,
      georef_rotation_deg REAL,
      georef_scale_m_per_px REAL,
      floor TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS map_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      map_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      x_px REAL NOT NULL,
      y_px REAL NOT NULL,
      lat REAL,
      lon REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (map_id) REFERENCES floor_maps(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS map_point_synonyms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      point_id INTEGER NOT NULL,
      synonym TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (point_id) REFERENCES map_points(id) ON DELETE CASCADE,
      UNIQUE(point_id, synonym)
    );
  `);
}

/**
 * Get the singleton database connection. Initializes the database on first
 * call.
 */
export function getDb(): Database.Database {
  initDb();
  if (!db) throw new Error('Failed to initialize database');
  return db;
}

/**
 * Retrieve an order by its item code. Returns undefined if no such order
 * exists.
 */
export function getOrder(code: string): OrderRecord | undefined {
  const stmt = getDb().prepare(
    `SELECT * FROM orders WHERE code = ? LIMIT 1`,
  );
  const row = stmt.get(code);
  return row as OrderRecord | undefined;
}

/**
 * Create a new order. Accepts an object containing the item code, arbitrary
 * JSON data (stored as a string) and optional floor/section assignments. If
 * an alias list is provided, the function inserts them into the aliases table.
 */
export function createOrder(
  code: string,
  data: any,
  floor: string,
  section: string,
  aliases?: string[],
): OrderRecord {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO orders (code, data, floor, section) VALUES (?, ?, ?, ?)`,
    ).run(code, JSON.stringify(data), floor, section);
    if (aliases) {
      const aliasStmt = db.prepare(
        `INSERT OR IGNORE INTO aliases (alias, code) VALUES (?, ?)`,
      );
      for (const alias of aliases) aliasStmt.run(alias, code);
    }
    const order = db.prepare(`SELECT * FROM orders WHERE code = ?`).get(code);
    return order as OrderRecord;
  });
  return tx();
}

/**
 * Update an existing order. Accepts a partial record with optional fields.
 */
export function updateOrder(
  code: string,
  updates: { collected?: boolean; data?: any; floor?: string; section?: string },
): OrderRecord | undefined {
  const db = getDb();
  const existing = getOrder(code);
  if (!existing) return undefined;
  const newCollected = updates.collected !== undefined ? (updates.collected ? 1 : 0) : existing.collected;
  const newData = updates.data !== undefined ? JSON.stringify(updates.data) : existing.data;
  const newFloor = updates.floor ?? existing.floor;
  const newSection = updates.section ?? existing.section;
  db.prepare(
    `UPDATE orders SET collected = ?, data = ?, floor = ?, section = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?`,
  ).run(newCollected, newData, newFloor, newSection, code);
  return getOrder(code);
}

/**
 * Resolve an item code or alias to the canonical order code and its location.
 * If multiple orders share the same alias (ambiguous), return undefined.
 */
export function resolveItemCode(codeOrAlias: string): { code: string; floor: string; section: string } | undefined {
  const db = getDb();
  // Try to match exact code first
  const direct = db
    .prepare(`SELECT code, floor, section FROM orders WHERE code = ?`)
    .get(codeOrAlias) as { code: string; floor: string; section: string } | undefined;
  if (direct) return direct;
  // Then look up alias mapping
  const aliasRows = db
    .prepare(`SELECT code FROM aliases WHERE alias = ?`)
    .all(codeOrAlias) as { code: string }[];
  if (aliasRows.length === 1) {
    const { code } = aliasRows[0];
    const order = db
      .prepare(`SELECT code, floor, section FROM orders WHERE code = ?`)
      .get(code) as { code: string; floor: string; section: string };
    return order;
  }
  // Ambiguous or not found
  return undefined;
}

const normalizeLabel = (label: string) => label.trim().toLowerCase();

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const computeLatLonFromPx = (
  map: FloorMapRecord,
  x: number,
  y: number,
): { lat: number | null; lon: number | null } => {
  const originLat = map.georef_origin_lat;
  const originLon = map.georef_origin_lon;
  const scale = map.georef_scale_m_per_px;
  if (originLat == null || originLon == null || !scale || Number.isNaN(scale)) {
    return { lat: originLat ?? null, lon: originLon ?? null };
  }
  const rotation = toRadians(map.georef_rotation_deg ?? 0);
  const metersEast = x * scale;
  const metersNorth = -y * scale;
  const rotatedEast = metersEast * Math.cos(rotation) - metersNorth * Math.sin(rotation);
  const rotatedNorth = metersEast * Math.sin(rotation) + metersNorth * Math.cos(rotation);
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos(toRadians(originLat));
  if (!metersPerDegreeLon) {
    return { lat: originLat + rotatedNorth / metersPerDegreeLat, lon: originLon };
  }
  return {
    lat: originLat + rotatedNorth / metersPerDegreeLat,
    lon: originLon + rotatedEast / metersPerDegreeLon,
  };
};

const getMapPointRow = (id: number): MapPointWithSynonyms | undefined => {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM map_points WHERE id = ?`).get(id) as MapPointRecord | undefined;
  if (!row) return undefined;
  const synonymRows = db
    .prepare(`SELECT synonym FROM map_point_synonyms WHERE point_id = ? ORDER BY synonym`)
    .all(id) as { synonym: string }[];
  return { ...row, synonyms: synonymRows.map((s) => s.synonym) };
};

export interface MapPointSearchResult {
  match: MapPointWithSynonyms | null;
  alternatives: MapPointWithSynonyms[];
}

export const listFloorMaps = (): FloorMapSummary[] => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT fm.*, (
          SELECT COUNT(*) FROM map_points mp WHERE mp.map_id = fm.id
        ) AS point_count
       FROM floor_maps fm
       ORDER BY fm.updated_at DESC`,
    )
    .all() as FloorMapSummary[];
  return rows;
};

export const getFloorMapById = (id: number): FloorMapRecord | undefined => {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM floor_maps WHERE id = ?`).get(id);
  return row as FloorMapRecord | undefined;
};

export const createFloorMap = (payload: {
  name: string;
  imagePath: string;
  width: number;
  height: number;
  georefOriginLat?: number | null;
  georefOriginLon?: number | null;
  georefRotationDeg?: number | null;
  georefScaleMetersPerPixel?: number | null;
  floor: string;
}): FloorMapRecord => {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO floor_maps (
        name,
        image_path,
        width,
        height,
        georef_origin_lat,
        georef_origin_lon,
        georef_rotation_deg,
        georef_scale_m_per_px,
        floor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      payload.name,
      payload.imagePath,
      payload.width,
      payload.height,
      payload.georefOriginLat ?? null,
      payload.georefOriginLon ?? null,
      payload.georefRotationDeg ?? null,
      payload.georefScaleMetersPerPixel ?? null,
      payload.floor,
    );
  const id = Number(info.lastInsertRowid);
  return getFloorMapById(id)!;
};

export const updateFloorMap = (
  id: number,
  updates: Partial<{
    name: string;
    georefOriginLat: number | null;
    georefOriginLon: number | null;
    georefRotationDeg: number | null;
    georefScaleMetersPerPixel: number | null;
    floor: string;
  }>,
): FloorMapRecord | undefined => {
  const db = getDb();
  const existing = getFloorMapById(id);
  if (!existing) return undefined;
  const next = {
    name: updates.name ?? existing.name,
    georef_origin_lat:
      updates.georefOriginLat !== undefined ? updates.georefOriginLat : existing.georef_origin_lat,
    georef_origin_lon:
      updates.georefOriginLon !== undefined ? updates.georefOriginLon : existing.georef_origin_lon,
    georef_rotation_deg:
      updates.georefRotationDeg !== undefined ? updates.georefRotationDeg : existing.georef_rotation_deg,
    georef_scale_m_per_px:
      updates.georefScaleMetersPerPixel !== undefined
        ? updates.georefScaleMetersPerPixel
        : existing.georef_scale_m_per_px,
    floor: updates.floor ?? existing.floor,
  };
  db.prepare(
    `UPDATE floor_maps
     SET name = ?,
         georef_origin_lat = ?,
         georef_origin_lon = ?,
         georef_rotation_deg = ?,
         georef_scale_m_per_px = ?,
         floor = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(
    next.name,
    next.georef_origin_lat,
    next.georef_origin_lon,
    next.georef_rotation_deg,
    next.georef_scale_m_per_px,
    next.floor,
    id,
  );
  return getFloorMapById(id) ?? undefined;
};

export const listMapPoints = (mapId: number): MapPointWithSynonyms[] => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT mp.*, GROUP_CONCAT(mps.synonym, '\u0001') AS synonyms
       FROM map_points mp
       LEFT JOIN map_point_synonyms mps ON mps.point_id = mp.id
       WHERE mp.map_id = ?
       GROUP BY mp.id
       ORDER BY mp.label COLLATE NOCASE`,
    )
    .all(mapId) as (MapPointRecord & { synonyms: string | null })[];
  return rows.map((row) => ({
    ...row,
    synonyms: row.synonyms ? row.synonyms.split('\u0001').filter(Boolean) : [],
  }));
};

export const createMapPoint = (payload: {
  mapId: number;
  label: string;
  x_px: number;
  y_px: number;
  synonyms?: string[];
}): MapPointWithSynonyms => {
  const map = getFloorMapById(payload.mapId);
  if (!map) throw new Error(`Map ${payload.mapId} not found`);
  const coords = computeLatLonFromPx(map, payload.x_px, payload.y_px);
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO map_points (map_id, label, x_px, y_px, lat, lon)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(payload.mapId, payload.label.trim(), payload.x_px, payload.y_px, coords.lat, coords.lon);
  const pointId = Number(info.lastInsertRowid);
  if (payload.synonyms?.length) {
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO map_point_synonyms (point_id, synonym)
       VALUES (?, ?)`,
    );
    for (const synonym of payload.synonyms) {
      const trimmed = synonym.trim();
      if (trimmed) stmt.run(pointId, trimmed);
    }
  }
  const point = getMapPointRow(pointId);
  if (!point) throw new Error('Failed to create map point');
  return point;
};

export const addSynonymsToPoint = (pointId: number, synonyms: string[]) => {
  if (!synonyms.length) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO map_point_synonyms (point_id, synonym)
     VALUES (?, ?)`,
  );
  for (const synonym of synonyms) {
    const trimmed = synonym.trim();
    if (trimmed) stmt.run(pointId, trimmed);
  }
};

export const searchMapPoint = (mapId: number, label: string): MapPointSearchResult => {
  const points = listMapPoints(mapId);
  const target = normalizeLabel(label);
  if (!target) return { match: null, alternatives: points.slice(0, 5) };
  const match = points.find((point) => {
    if (normalizeLabel(point.label) === target) return true;
    return point.synonyms.some((syn) => normalizeLabel(syn) === target);
  });
  if (match) {
    return { match, alternatives: points.filter((p) => p.id !== match.id).slice(0, 5) };
  }
  const alternatives = points
    .filter((point) => {
      if (point.label && normalizeLabel(point.label).includes(target)) return true;
      return point.synonyms.some((syn) => normalizeLabel(syn).includes(target));
    })
    .slice(0, 5);
  return { match: null, alternatives };
};