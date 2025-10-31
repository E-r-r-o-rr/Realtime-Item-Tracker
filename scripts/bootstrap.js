const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const ROOT_DIR = process.cwd();
const DATA_DIR = path.join(ROOT_DIR, "data");
const DB_PATH = path.join(DATA_DIR, "app.db");
const MAPS_DIR = path.join(DATA_DIR, "maps");
const MAP_FIXTURES_DIR = path.join(ROOT_DIR, "fixtures", "maps");

const logisticsSeeds = [
  {
    destination: "R1-A",
    itemName: "Widget Alpha",
    trackingId: "TRACK-1001",
    truckNumber: "TRUCK-21",
    shipDate: "2025-03-18",
    expectedDepartureTime: "08:30",
    originLocation: "Dock 1",
    booked: true,
  },
  {
    destination: "R3-C",
    itemName: "Gizmo Delta",
    trackingId: "TRACK-1002",
    truckNumber: "TRUCK-09",
    shipDate: "2025-03-18",
    expectedDepartureTime: "09:15",
    originLocation: "Dock 3",
    booked: false,
  },
  {
    destination: "R7-B",
    itemName: "Crate Horizon",
    trackingId: "TRACK-1003",
    truckNumber: "TRUCK-42",
    shipDate: "2025-03-19",
    expectedDepartureTime: "07:45",
    originLocation: "Inbound A",
    booked: true,
  },
];

const liveBufferSeeds = logisticsSeeds.slice(0, 2);

const MELBOURNE_TIME_ZONE = "Australia/Melbourne";

const formatDateTimeInTimeZone = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  });
  const parts = formatter.formatToParts(date);
  const lookup = (type) => {
    const part = parts.find((entry) => entry.type === type);
    return part ? part.value : "";
  };
  const isoDate = `${lookup("year")}-${lookup("month")}-${lookup("day")}T${lookup("hour")}:${lookup("minute")}:${lookup(
    "second",
  )}`;
  const timeZoneName = lookup("timeZoneName") || "UTC";
  const offsetMatch = timeZoneName.replace(/^GMT/, "").replace(/^UTC/, "").match(/([+-]\d{2})(?::?(\d{2}))?/);
  const offsetHours = offsetMatch && offsetMatch[1] ? offsetMatch[1] : "+00";
  const offsetMinutes = offsetMatch && offsetMatch[2] ? offsetMatch[2] : "00";
  return `${isoDate}${offsetHours}:${offsetMinutes}`;
};

const getTimestamp = () => formatDateTimeInTimeZone(new Date(), MELBOURNE_TIME_ZONE);

const ensureDataDirectories = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (fs.existsSync(DB_PATH)) {
    fs.rmSync(DB_PATH);
  }
  if (fs.existsSync(MAPS_DIR)) {
    fs.rmSync(MAPS_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(MAPS_DIR, { recursive: true });
};

const copyMapFixtures = () => {
  if (!fs.existsSync(MAP_FIXTURES_DIR)) {
    throw new Error(`Missing map fixtures in ${MAP_FIXTURES_DIR}`);
  }
  const files = fs.readdirSync(MAP_FIXTURES_DIR).filter((file) => file.toLowerCase().endsWith(".svg"));
  if (files.length === 0) {
    throw new Error(`No SVG fixtures found in ${MAP_FIXTURES_DIR}`);
  }

  const relativePaths = [];
  for (const file of files) {
    const source = path.join(MAP_FIXTURES_DIR, file);
    const destination = path.join(MAPS_DIR, file);
    fs.copyFileSync(source, destination);
    relativePaths.push(path.join("maps", file));
  }
  return relativePaths;
};

const createDatabase = () => {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  db.exec(`
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
  return db;
};

const EARTH_RADIUS_M = 6378137;
const RAD_TO_DEG = 180 / Math.PI;

const computeLatLonForPoint = (map, xPx, yPx) => {
  const originLat = map.georef_origin_lat || 0;
  const originLon = map.georef_origin_lon || 0;
  const scale = map.georef_scale_m_per_px || 1;
  const rotationRad = ((map.georef_rotation_deg || 0) * Math.PI) / 180;

  const eastMetersUnrotated = xPx * scale;
  const northMetersUnrotated = -yPx * scale;

  const eastMeters = eastMetersUnrotated * Math.cos(rotationRad) - northMetersUnrotated * Math.sin(rotationRad);
  const northMeters = eastMetersUnrotated * Math.sin(rotationRad) + northMetersUnrotated * Math.cos(rotationRad);

  const lat = originLat + (northMeters / EARTH_RADIUS_M) * RAD_TO_DEG;
  const lonDenominator = Math.cos((originLat * Math.PI) / 180);
  const lon = originLon + (eastMeters / (EARTH_RADIUS_M * (lonDenominator === 0 ? 1e-9 : lonDenominator))) * RAD_TO_DEG;
  return { lat, lon };
};

const seedFloorMaps = (db, mapPaths) => {
  if (mapPaths.length === 0) {
    throw new Error("Provide at least one map fixture before seeding floor maps");
  }

  const timestamp = getTimestamp();
  const [primaryMapPath] = mapPaths;
  const insertMap = db.prepare(`
    INSERT INTO floor_maps
      (name, floor, destination_tag, image_path, width, height, georef_origin_lat, georef_origin_lon, georef_rotation_deg, georef_scale_m_per_px, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const mapInfo = insertMap.run(
    "Demo Warehouse",
    "Ground",
    "DEMO",
    primaryMapPath,
    1200,
    600,
    -37.8183,
    144.9671,
    0,
    0.25,
    timestamp,
    timestamp,
  );

  const mapId = Number(mapInfo.lastInsertRowid);
  const mapRecord = {
    id: mapId,
    georef_origin_lat: -37.8183,
    georef_origin_lon: 144.9671,
    georef_rotation_deg: 0,
    georef_scale_m_per_px: 0.25,
  };

  const insertPoint = db.prepare(`
    INSERT INTO map_points
      (map_id, label, synonyms, x_px, y_px, lat, lon, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const pointTimestamp = getTimestamp();
  const points = [
    { label: "Dock 1", synonyms: ["Inbound A"], xPx: 140, yPx: 420 },
    { label: "Packing Line", synonyms: ["Line 3"], xPx: 420, yPx: 260 },
    { label: "Dispatch", synonyms: ["Outbound"], xPx: 920, yPx: 220 },
  ];

  points.forEach((point) => {
    const { lat, lon } = computeLatLonForPoint(mapRecord, point.xPx, point.yPx);
    insertPoint.run(
      mapId,
      point.label,
      JSON.stringify(point.synonyms),
      point.xPx,
      point.yPx,
      lat,
      lon,
      pointTimestamp,
      pointTimestamp,
    );
  });

  return { id: mapId, imagePath: primaryMapPath, name: "Demo Warehouse" };
};

const generateScanId = (seed) => {
  if (Number.isFinite(seed)) {
    return `SCAN-${String(seed).padStart(6, "0")}`;
  }
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SCAN-${Date.now()}-${random}`;
};

const seedLogisticsData = (db) => {
  const timestamp = getTimestamp();
  const insertStorage = db.prepare(`
    INSERT INTO storage
      (destination, item_name, tracking_id, truck_number, ship_date, expected_departure_time, origin_location, booked, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertBooking = db.prepare(`
    INSERT INTO bookings
      (destination, item_name, tracking_id, truck_number, ship_date, expected_departure_time, origin_location, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertLiveBuffer = db.prepare(`
    INSERT INTO live_buffer
      (destination, item_name, tracking_id, truck_number, ship_date, expected_departure_time, origin_location, last_synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertHistory = db.prepare(`
    INSERT INTO history
      (destination, item_name, tracking_id, truck_number, ship_date, expected_departure_time, origin_location, scan_id, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const storageSummaries = [];
  logisticsSeeds.forEach((seed) => {
    insertStorage.run(
      seed.destination,
      seed.itemName,
      seed.trackingId,
      seed.truckNumber,
      seed.shipDate,
      seed.expectedDepartureTime,
      seed.originLocation,
      seed.booked ? 1 : 0,
      timestamp,
    );
    if (seed.booked) {
      insertBooking.run(
        seed.destination,
        seed.itemName,
        seed.trackingId,
        seed.truckNumber,
        seed.shipDate,
        seed.expectedDepartureTime,
        seed.originLocation,
        timestamp,
      );
    }
    storageSummaries.push({ trackingId: seed.trackingId, booked: !!seed.booked });
  });

  const liveBufferSummaries = [];
  liveBufferSeeds.forEach((seed, index) => {
    insertLiveBuffer.run(
      seed.destination,
      seed.itemName,
      seed.trackingId,
      seed.truckNumber,
      seed.shipDate,
      seed.expectedDepartureTime,
      seed.originLocation,
      timestamp,
    );
    const scanId = generateScanId(index + 1);
    insertHistory.run(
      seed.destination,
      seed.itemName,
      seed.trackingId,
      seed.truckNumber,
      seed.shipDate,
      seed.expectedDepartureTime,
      seed.originLocation,
      scanId,
      timestamp,
    );
    liveBufferSummaries.push({ trackingId: seed.trackingId, bookingFound: !!seed.booked });
  });

  return { storageSummaries, liveBufferSummaries };
};

const main = () => {
  console.log("\n💾 Resetting local database and map fixtures...");
  ensureDataDirectories();

  console.log("📦 Copying canonical map assets...");
  const mapPaths = copyMapFixtures();

  console.log("🗄️ Rebuilding SQLite schema...");
  const db = createDatabase();

  console.log("🗺️ Seeding floor map metadata...");
  const map = seedFloorMaps(db, mapPaths);

  console.log("🚚 Populating demo logistics records...");
  const { storageSummaries, liveBufferSummaries } = seedLogisticsData(db);

  db.close();

  console.log("✅ Bootstrap complete! Summary:");
  console.table(storageSummaries);
  console.table(liveBufferSummaries);
  console.log(`\nMap ready: ${map.name} (image: ${map.imagePath})`);
};

try {
  main();
} catch (error) {
  console.error("Bootstrap failed:", error);
  process.exitCode = 1;
}
