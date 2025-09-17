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