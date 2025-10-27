import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const PY_BIN =
  process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
const BARCODE_SCRIPT = path.join(process.cwd(), 'scripts', 'barcode_decode.py');
const BARCODE_TIMEOUT_MS = Number(process.env.BARCODE_TIMEOUT_MS || 30_000);

const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const OCR_ID_KEY_GROUPS: string[][] = [
  ['item_code', 'itemcode'],
  ['order_id', 'orderid'],
  ['tracking_id', 'trackingid'],
  ['tracking_number', 'trackingnumber'],
  ['tracking_no', 'trackingno'],
  ['order_reference', 'orderreference'],
  ['order_ref', 'orderref'],
  ['id'],
];

interface NormalizedOcrEntry {
  normalizedKey: string;
  originalKey: string;
  value: string;
}

const MIN_COMPARABLE_LENGTH = 3;

export interface BarcodeExtractionResult {
  barcodes: string[];
  warnings: string[];
}

function normalizeBarcodeValue(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function buildNormalizedOcrEntries(kv: Record<string, string> | undefined | null) {
  const map = new Map<string, NormalizedOcrEntry>();
  if (!kv) {
    return map;
  }

  for (const [rawKey, rawValue] of Object.entries(kv)) {
    if (typeof rawValue !== 'string') continue;
    const trimmedValue = rawValue.trim();
    if (!trimmedValue) continue;
    const normalizedKey = normalizeKey(rawKey);
    if (!normalizedKey) continue;

    const existing = map.get(normalizedKey);
    if (!existing || trimmedValue.length > existing.value.length) {
      map.set(normalizedKey, {
        normalizedKey,
        originalKey: rawKey,
        value: trimmedValue,
      });
    }
  }

  return map;
}

function pickPreferredOcrId(entries: Map<string, NormalizedOcrEntry>): NormalizedOcrEntry | null {
  for (const group of OCR_ID_KEY_GROUPS) {
    for (const alias of group) {
      const normalized = normalizeKey(alias);
      if (!normalized) continue;
      const entry = entries.get(normalized);
      if (entry) return entry;
    }
  }

  let fallback: NormalizedOcrEntry | null = null;
  for (const entry of entries.values()) {
    const comparable = normalizeBarcodeValue(entry.value);
    if (comparable.length < MIN_COMPARABLE_LENGTH) continue;
    if (!/[0-9]/.test(comparable)) continue;
    if (!fallback) {
      fallback = entry;
      continue;
    }
    const fallbackComparable = normalizeBarcodeValue(fallback.value);
    if (comparable.length > fallbackComparable.length) {
      fallback = entry;
    }
  }

  return fallback;
}

function prettifyKeyLabel(rawKey: string): string {
  if (!rawKey) {
    return 'identifier';
  }
  const trimmed = rawKey.trim();
  if (!trimmed) {
    return 'identifier';
  }
  if (/\s/.test(trimmed)) {
    return trimmed;
  }
  const withSpaces = trimmed.replace(/_/g, ' ');
  return withSpaces
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function stubFromFilename(filePath: string): BarcodeExtractionResult {
  const basename = path.basename(filePath);
  const match = basename.match(/[A-Za-z0-9]{4,}/);
  const token = match ? match[0].toUpperCase() : '';
  const barcodes = token ? [token] : [];
  const warnings = ['Barcode decoder unavailable or failed. Using filename heuristic.'];
  return { barcodes, warnings };
}

export async function extractBarcodes(filePath: string): Promise<BarcodeExtractionResult> {
  // If script isn't present, immediately stub.
  if (!fs.existsSync(BARCODE_SCRIPT)) {
    return stubFromFilename(filePath);
  }

  const args = [BARCODE_SCRIPT, '--image', filePath];
  let timer: NodeJS.Timeout | null = null;

  try {
    const { stdout, stderr, code, signal } = await new Promise<{
      stdout: string;
      stderr: string;
      code: number;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      const child = spawn(PY_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';

      timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
      }, BARCODE_TIMEOUT_MS);

      child.stdout.on('data', (c) => (stdout += c.toString()));
      child.stderr.on('data', (c) => (stderr += c.toString()));
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ stdout, stderr, code: code ?? 0, signal }));
    });

    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    if (code !== 0) {
      console.warn('Barcode decoder non-zero exit', { code, signal, stderr });
      return stubFromFilename(filePath);
    }

    try {
      const payload = JSON.parse((stdout || '{}').trim());
      const rawBarcodes = Array.isArray(payload.barcodes) ? payload.barcodes : [];
      const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];

      // Normalize to avoid punctuation / case mismatches downstream
      const barcodes = rawBarcodes.map((b: unknown) => String(b)).filter(Boolean);
      return { barcodes, warnings };
    } catch (err) {
      console.warn('Failed to parse barcode decoder output', err);
      return stubFromFilename(filePath);
    }
  } catch (err) {
    if (timer) clearTimeout(timer);
    console.warn('Error running barcode decoder:', err);
    return stubFromFilename(filePath);
  }
}

export function buildBarcodeValidation(
  kv: Record<string, string> | undefined | null,
  barcodes: string[],
): {
  matches: boolean | null;
  status: 'match' | 'mismatch' | 'no_barcode' | 'missing_item_code';
  message: string;
  comparedValue?: string;
} {
  const sanitizedBarcodes = (Array.isArray(barcodes) ? barcodes : [])
    .map((code) => (typeof code === 'string' ? code : String(code ?? '')))
    .map((code) => code.trim())
    .filter((code) => code.length > 0);

  if (!sanitizedBarcodes.length) {
    return {
      matches: null,
      status: 'no_barcode',
      message: 'No barcode values detected to validate against.',
    };
  }

  const normalizedEntries = buildNormalizedOcrEntries(kv ?? null);
  const preferredEntry = pickPreferredOcrId(normalizedEntries);

  if (!preferredEntry) {
    return {
      matches: null,
      status: 'missing_item_code',
      message: 'OCR extraction did not produce a tracking or order identifier to compare with barcode data.',
      comparedValue: sanitizedBarcodes.join(', '),
    };
  }

  const comparableItem = normalizeBarcodeValue(preferredEntry.value);
  if (comparableItem.length < MIN_COMPARABLE_LENGTH) {
    return {
      matches: null,
      status: 'missing_item_code',
      message: 'OCR extraction did not produce a tracking or order identifier to compare with barcode data.',
      comparedValue: sanitizedBarcodes.join(', '),
    };
  }

  const normalizedBarcodes = sanitizedBarcodes.map((raw) => ({
    raw,
    comparable: normalizeBarcodeValue(raw),
  }));

  const matchingBarcodes = normalizedBarcodes.filter((barcode) =>
    barcode.comparable.includes(comparableItem),
  );
  const matched = matchingBarcodes.length > 0;

  const fieldLabel = prettifyKeyLabel(preferredEntry.originalKey);
  const comparedValue = sanitizedBarcodes.join(', ');

  return {
    matches: matched,
    status: matched ? 'match' : 'mismatch',
    comparedValue,
    message: matched
      ? `OCR ${fieldLabel} ${preferredEntry.value} matches barcode value(s): ${matchingBarcodes
          .map((barcode) => barcode.raw)
          .join(', ')}.`
      : `OCR ${fieldLabel} ${preferredEntry.value} does not match barcode value(s): ${comparedValue}.`,
  };
}
