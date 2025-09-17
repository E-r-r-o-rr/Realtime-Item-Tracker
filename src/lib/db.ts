import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { bookingSamples, storageSamples } from '@/data/orderSamples';

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

let db: Database.Database | null = null;

function ensureDataDirectory() {
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'app.db');
}

function seedWarehouseTables(connection: Database.Database) {
  const bookingCount = connection.prepare(`SELECT COUNT(*) as count FROM bookings`).get() as { count: number };
  if (bookingCount.count === 0) {
    const insertBooking = connection.prepare(
      `INSERT INTO bookings (tracking_id, destination, item_name, truck_number, ship_date, expected_departure, origin)
       VALUES (@trackingId, @destination, @itemName, @truckNumber, @shipDate, @expectedDeparture, @origin)`,
    );
    const runBookingSeed = connection.transaction(() => {
      for (const booking of bookingSamples) {
        insertBooking.run(booking);
      }
    });
    runBookingSeed();
  }

  const storageCount = connection.prepare(`SELECT COUNT(*) as count FROM storage`).get() as { count: number };
  if (storageCount.count === 0) {
    const insertStorage = connection.prepare(
      `INSERT INTO storage (id, destination, item_name, tracking_id, truck_number, ship_date, expected_departure, origin)
       VALUES (@id, @destination, @itemName, @trackingId, @truckNumber, @shipDate, @expectedDeparture, @origin)`,
    );
    const runStorageSeed = connection.transaction(() => {
      for (const row of storageSamples) {
        insertStorage.run(row);
      }
    });
    runStorageSeed();
  }
}

function initDb() {
  if (db) return;
  const dbPath = ensureDataDirectory();
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
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
    CREATE TABLE IF NOT EXISTS bookings (
      tracking_id TEXT PRIMARY KEY,
      destination TEXT NOT NULL,
      item_name TEXT NOT NULL,
      truck_number TEXT NOT NULL,
      ship_date TEXT NOT NULL,
      expected_departure TEXT NOT NULL,
      origin TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS storage (
      id TEXT PRIMARY KEY,
      destination TEXT NOT NULL,
      item_name TEXT NOT NULL,
      tracking_id TEXT NOT NULL,
      truck_number TEXT NOT NULL,
      ship_date TEXT NOT NULL,
      expected_departure TEXT NOT NULL,
      origin TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scanned_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destination TEXT NOT NULL,
      item_name TEXT NOT NULL,
      tracking_id TEXT NOT NULL,
      truck_number TEXT NOT NULL,
      ship_date TEXT NOT NULL,
      expected_departure TEXT NOT NULL,
      origin TEXT NOT NULL,
      scanned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS current_scan (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      raw_destination TEXT,
      raw_item_name TEXT,
      raw_tracking_id TEXT,
      raw_truck_number TEXT,
      raw_ship_date TEXT,
      raw_expected_departure TEXT,
      raw_origin TEXT,
      resolved_destination TEXT,
      resolved_item_name TEXT,
      resolved_tracking_id TEXT,
      resolved_truck_number TEXT,
      resolved_ship_date TEXT,
      resolved_expected_departure TEXT,
      resolved_origin TEXT,
      scanned_at TEXT,
      booking_match INTEGER,
      booking_message TEXT,
      storage_match INTEGER,
      storage_message TEXT,
      storage_row_id TEXT,
      last_refreshed TEXT
    );
  `);

  seedWarehouseTables(db);
}

export function getDb(): Database.Database {
  initDb();
  if (!db) throw new Error('Failed to initialize database');
  return db;
}

export function getOrder(code: string): OrderRecord | undefined {
  const stmt = getDb().prepare(`SELECT * FROM orders WHERE code = ? LIMIT 1`);
  const row = stmt.get(code);
  return row as OrderRecord | undefined;
}

export function createOrder(
  code: string,
  data: any,
  floor: string,
  section: string,
  aliases?: string[],
): OrderRecord {
  const database = getDb();
  const tx = database.transaction(() => {
    database.prepare(`INSERT INTO orders (code, data, floor, section) VALUES (?, ?, ?, ?)`).run(code, JSON.stringify(data), floor, section);
    if (aliases) {
      const aliasStmt = database.prepare(`INSERT OR IGNORE INTO aliases (alias, code) VALUES (?, ?)`);
      for (const alias of aliases) aliasStmt.run(alias, code);
    }
    const order = database.prepare(`SELECT * FROM orders WHERE code = ?`).get(code);
    return order as OrderRecord;
  });
  return tx();
}

export function updateOrder(
  code: string,
  updates: { collected?: boolean; data?: any; floor?: string; section?: string },
): OrderRecord | undefined {
  const database = getDb();
  const existing = getOrder(code);
  if (!existing) return undefined;
  const newCollected = updates.collected !== undefined ? (updates.collected ? 1 : 0) : existing.collected;
  const newData = updates.data !== undefined ? JSON.stringify(updates.data) : existing.data;
  const newFloor = updates.floor ?? existing.floor;
  const newSection = updates.section ?? existing.section;
  database
    .prepare(
      `UPDATE orders SET collected = ?, data = ?, floor = ?, section = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?`,
    )
    .run(newCollected, newData, newFloor, newSection, code);
  return getOrder(code);
}

export function resolveItemCode(codeOrAlias: string): { code: string; floor: string; section: string } | undefined {
  const database = getDb();
  const direct = database
    .prepare(`SELECT code, floor, section FROM orders WHERE code = ?`)
    .get(codeOrAlias) as { code: string; floor: string; section: string } | undefined;
  if (direct) return direct;
  const aliasRows = database
    .prepare(`SELECT code FROM aliases WHERE alias = ?`)
    .all(codeOrAlias) as { code: string }[];
  if (aliasRows.length === 1) {
    const { code } = aliasRows[0];
    const order = database
      .prepare(`SELECT code, floor, section FROM orders WHERE code = ?`)
      .get(code) as { code: string; floor: string; section: string };
    return order;
  }
  return undefined;
}
