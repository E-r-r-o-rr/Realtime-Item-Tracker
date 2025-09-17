import fs from 'fs';
import { resolveMap, MapEntry } from './mapIndex';
import LRUCache from 'lru-cache';

/**
 * Metadata returned alongside map buffers. Includes basic HTTP header
 * information used for conditional requests (ETag, Last-Modified, Content-Length)
 * and our custom metadata (checksum, floor, section).
 */
export interface MapMetadata {
  /** Unique key identifying the map entry. */
  key: string;
  /** SHA256 checksum of the file contents. */
  checksum: string;
  /** File size in bytes. */
  size: number;
  /** Last modification timestamp in milliseconds. */
  mtimeMs: number;
  /** HTTP ETag derived from the checksum. */
  etag: string;
  /** HTTP Last-Modified header value. */
  lastModified: string;
  /** Floor identifier. */
  floor: string;
  /** Section identifier (optional). */
  section?: string;
}

interface CachedMap {
  buffer: Buffer;
  meta: MapMetadata;
}

// LRU cache to store map buffers in memory. Each entry is keyed by the
// map key (file name without extension). We cap the cache at 10 entries
// because maps are relatively small but we don't want unlimited growth.
const cache = new LRUCache<string, CachedMap>({ max: 10 });

/**
 * Retrieve a map buffer and metadata for a given floor/section. If the map is
 * cached, it is returned from memory; otherwise it is read from disk and
 * cached. Returns undefined if no map exists for the provided identifiers.
 */
export function getMap(floor: string, section?: string): CachedMap | undefined {
  const entry = resolveMap(floor, section);
  if (!entry) return undefined;
  const key = entry.key;
  const cached = cache.get(key);
  if (cached) return cached;
  const buffer = fs.readFileSync(entry.filePath);
  const meta: MapMetadata = {
    key,
    checksum: entry.checksum,
    size: entry.size,
    mtimeMs: entry.mtimeMs,
    etag: `W/"${entry.checksum}"`,
    lastModified: new Date(entry.mtimeMs).toUTCString(),
    floor: entry.floor,
    section: entry.section,
  };
  const result = { buffer, meta };
  cache.set(key, result);
  return result;
}

/**
 * Retrieve a map directly by its key (the filename without extension). This is
 * useful for the /maps endpoint where the caller already knows the key via
 * the `/items/{code}/map` API. Returns undefined if the key does not exist.
 */
export function getMapByKey(key: string): CachedMap | undefined {
  const cached = cache.get(key);
  if (cached) return cached;
  // Look up entry by key from the index
  const index = resolveMap(key, undefined); // Not ideal but keys align with floors
  // The above call attempts to treat `key` as a floor. Instead we scan the map
  // index manually; this fallback avoids unnecessary parsing.
  const entries = require('./mapIndex').generateMapIndex() as MapEntry[];
  const entry = entries.find((e: MapEntry) => e.key === key);
  if (!entry) return undefined;
  const buffer = fs.readFileSync(entry.filePath);
  const meta: MapMetadata = {
    key: entry.key,
    checksum: entry.checksum,
    size: entry.size,
    mtimeMs: entry.mtimeMs,
    etag: `W/"${entry.checksum}"`,
    lastModified: new Date(entry.mtimeMs).toUTCString(),
    floor: entry.floor,
    section: entry.section,
  };
  const result = { buffer, meta };
  cache.set(key, result);
  return result;
}