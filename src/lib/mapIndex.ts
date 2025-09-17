import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface MapEntry {
  /** Unique key identifying the map (file name without extension). */
  key: string;
  /** Absolute file system path to the PNG file. */
  filePath: string;
  /** URL path at which the map is served (relative to `/maps`). */
  urlPath: string;
  /** Floor identifier, extracted from the filename. */
  floor: string;
  /** Optional section identifier, if present in the filename. */
  section?: string;
  /** Hex-encoded SHA256 checksum of the file contents. */
  checksum: string;
  /** File size in bytes. */
  size: number;
  /** Last modification timestamp, in milliseconds since epoch. */
  mtimeMs: number;
}

/**
 * Generate a map index by scanning the `public/maps` folder. The index is
 * computed lazily and cached to avoid repeated I/O. File names must follow
 * the convention `floorX.png` or `floorX-section-Y.png` as described in
 * US 4.1. Checksums are computed with SHA256 as required for map validation.
 */
let cachedIndex: MapEntry[] | null = null;
export function generateMapIndex(): MapEntry[] {
  if (cachedIndex) return cachedIndex;
  const mapsDir = path.join(process.cwd(), 'public', 'maps');
  const files = fs.existsSync(mapsDir) ? fs.readdirSync(mapsDir) : [];
  const entries: MapEntry[] = [];
  for (const file of files) {
    if (!file.toLowerCase().endsWith('.png')) continue;
    const filePath = path.join(mapsDir, file);
    const stat = fs.statSync(filePath);
    const key = file.replace(/\.png$/, '');
    // Parse floor and section from the filename: floor1-section-a
    const match = /^floor(-?\w+)(?:-section-([\w-]+))?$/.exec(key);
    if (!match) continue;
    const floor = match[1];
    const section = match[2];
    const buffer = fs.readFileSync(filePath);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    entries.push({
      key,
      filePath,
      urlPath: `/maps/${file}`,
      floor,
      section,
      checksum,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  }
  cachedIndex = entries;
  // Persist the index to a JSON file for CI checks as required by US 4.1. This
  // file can be committed and validated during continuous integration to
  // detect missing or duplicate assets.
  try {
    const outPath = path.join(process.cwd(), 'map_index.json');
    fs.writeFileSync(outPath, JSON.stringify(entries, null, 2));
  } catch (err) {
    // Ignore write errors in runtime environment.
  }
  return entries;
}

/**
 * Resolve a floor/section pair to a map entry. If a specific section map is
 * unavailable, fall back to the floor map. Returns undefined if no map is
 * found. This function supports the US 4.3 requirement for section→floor
 * fallback and consistent errors.
 */
export function resolveMap(floor: string, section?: string): MapEntry | undefined {
  const index = generateMapIndex();
  // Try full match first
  if (section) {
    const fullKey = index.find(e => e.floor === floor && e.section === section);
    if (fullKey) return fullKey;
  }
  // Fallback to floor-only map
  return index.find(e => e.floor === floor && !e.section);
}