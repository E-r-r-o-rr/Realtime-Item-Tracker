import { spawn } from 'child_process';
import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';

const PY_BIN =
  process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
const BARCODE_EXTRACTOR_SCRIPT = path.join(process.cwd(), 'scripts', 'barcode_decode.py');
const BARCODE_MATCH_SCRIPT = path.join(process.cwd(), 'scripts', 'barcode_ocr_match.py');
const BARCODE_TIMEOUT_MS = Number(process.env.BARCODE_TIMEOUT_MS || 30_000);
const MATCH_TIMEOUT_MS = Number(process.env.BARCODE_MATCH_TIMEOUT_MS || 30_000);

export interface BarcodeDecodePosition {
  top_left?: [number, number];
  top_right?: [number, number];
  bottom_right?: [number, number];
  bottom_left?: [number, number];
  [key: string]: unknown;
}

export interface BarcodeDecodeEntry {
  text: string;
  format?: string;
  symbologyIdentifier?: string;
  isGs1?: boolean;
  position?: BarcodeDecodePosition | null;
}

export interface BarcodeExtractionResult {
  entries: BarcodeDecodeEntry[];
  warnings: string[];
}

export type BarcodeComparisonStatus = 'MATCH' | 'MISMATCH' | 'MISSING';

export interface BarcodeComparisonRow {
  key: string;
  ocr: string;
  barcodeLabel: string;
  barcodeValue: string;
  status: BarcodeComparisonStatus;
  contextLabel?: string;
}

export interface BarcodeComparisonSummary {
  matched: number;
  mismatched: number;
  missing: number;
}

export interface BarcodeOnlyEntry {
  class: string;
  labels: string[];
  value: string;
  count: number;
}

export interface BarcodeComparisonReport {
  rows: BarcodeComparisonRow[];
  summary: BarcodeComparisonSummary;
  library: {
    entriesCount: number;
    missedByOcrCount: number;
    missedByOcr: BarcodeOnlyEntry[];
  };
  barcodeText: string;
}

export interface BarcodeValidationResult {
  matches: boolean | null;
  status: 'match' | 'mismatch' | 'no_barcode' | 'missing_item_code';
  message: string;
  comparedValue?: string;
}

interface PythonExecutionResult {
  stdout: string;
  stderr: string;
  code: number;
  signal: NodeJS.Signals | null;
}

const MIN_STUB_TOKEN_LENGTH = 4;

function stubFromFilename(filePath: string): BarcodeExtractionResult {
  const basename = path.basename(filePath);
  const match = basename.match(/[A-Za-z0-9]{4,}/);
  const token = match ? match[0].toUpperCase() : '';
  const entries: BarcodeDecodeEntry[] = token
    ? [
        {
          text: token,
          format: 'stub',
        },
      ]
    : [];
  const warnings = ['Barcode decoder unavailable or failed. Using filename heuristic.'];
  return { entries, warnings };
}

function sanitizeDecodeEntry(raw: unknown): BarcodeDecodeEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const text = typeof value.text === 'string' ? value.text : '';
  if (!text) return null;
  const format = typeof value.format === 'string' ? value.format : undefined;
  const symbologyIdentifier =
    typeof value.symbology_identifier === 'string' ? value.symbology_identifier : undefined;
  const isGs1 = typeof value.is_gs1 === 'boolean' ? value.is_gs1 : undefined;
  const position = value.position && typeof value.position === 'object' ? value.position : undefined;

  return {
    text,
    format,
    symbologyIdentifier,
    isGs1,
    position: position as BarcodeDecodePosition | undefined,
  };
}

async function runPythonScript(
  scriptPath: string,
  args: string[],
  timeoutMs: number,
): Promise<PythonExecutionResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(PY_BIN, [scriptPath, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
    }, timeoutMs);

    child.stdout.on('data', (c) => {
      stdout += c.toString();
    });

    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });

    child.on('error', (err) => {
      cleanup();
      reject(err);
    });

    child.on('close', (code, signal) => {
      cleanup();
      resolve({ stdout, stderr, code: code ?? 0, signal });
    });
  });
}

export async function extractBarcodes(filePath: string): Promise<BarcodeExtractionResult> {
  if (!fs.existsSync(BARCODE_EXTRACTOR_SCRIPT)) {
    return stubFromFilename(filePath);
  }

  try {
    const { stdout, stderr, code } = await runPythonScript(BARCODE_EXTRACTOR_SCRIPT, [filePath], BARCODE_TIMEOUT_MS);
    if (code !== 0) {
      console.warn('Barcode extractor exited with non-zero code', { code, stderr });
      return stubFromFilename(filePath);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout || '[]');
    } catch (err) {
      console.warn('Failed to parse barcode extractor output', err);
      return stubFromFilename(filePath);
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const maybeError = (parsed as { error?: unknown }).error;
      if (typeof maybeError === 'string' && maybeError.trim()) {
        console.warn('Barcode extractor reported error', maybeError);
        const stub = stubFromFilename(filePath);
        stub.warnings.push(maybeError.trim());
        return stub;
      }
    }

    const entriesRaw = Array.isArray(parsed) ? parsed : [];
    const entries: BarcodeDecodeEntry[] = [];
    for (const entry of entriesRaw) {
      const sanitized = sanitizeDecodeEntry(entry);
      if (sanitized) {
        entries.push(sanitized);
      }
    }

    const warnings: string[] = [];
    if (entries.length === 0) {
      warnings.push('No barcode values detected by decoder.');
    }

    return { entries, warnings };
  } catch (err) {
    console.warn('Error running barcode extractor:', err);
    return stubFromFilename(filePath);
  }
}

function isMeaningfulOcrValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return !Number.isNaN(value);
  if (Array.isArray(value)) return value.some((v) => isMeaningfulOcrValue(v));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) => isMeaningfulOcrValue(v));
  }
  return false;
}

function parseComparisonRow(raw: unknown): BarcodeComparisonRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const statusRaw = typeof value.status === 'string' ? value.status.toUpperCase() : 'MISSING';
  const status: BarcodeComparisonStatus =
    statusRaw === 'MATCH' || statusRaw === 'MISMATCH' || statusRaw === 'MISSING' ? statusRaw : 'MISSING';

  return {
    key: typeof value.key === 'string' ? value.key : '',
    ocr: typeof value.ocr === 'string' ? value.ocr : '',
    barcodeLabel: typeof value.barcode_label === 'string' ? value.barcode_label : '',
    barcodeValue: typeof value.barcode_value === 'string' ? value.barcode_value : '',
    status,
    contextLabel: typeof value.context_label === 'string' ? value.context_label : undefined,
  };
}

function parseComparisonSummary(raw: unknown): BarcodeComparisonSummary {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const numberOrZero = (input: unknown) => (typeof input === 'number' && Number.isFinite(input) ? input : 0);
  return {
    matched: numberOrZero(value.matched),
    mismatched: numberOrZero(value.mismatched),
    missing: numberOrZero(value.missing),
  };
}

function parseBarcodeOnlyEntries(raw: unknown): BarcodeOnlyEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const value = entry as Record<string, unknown>;
      return {
        class: typeof value.class === 'string' ? value.class : 'unknown',
        labels: Array.isArray(value.labels)
          ? value.labels.filter((lbl): lbl is string => typeof lbl === 'string')
          : [],
        value: typeof value.value === 'string' ? value.value : '',
        count: typeof value.count === 'number' && Number.isFinite(value.count) ? value.count : 0,
      } as BarcodeOnlyEntry;
    })
    .filter((entry): entry is BarcodeOnlyEntry => Boolean(entry));
}

function parseComparisonReport(raw: unknown): BarcodeComparisonReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const rowsRaw = Array.isArray(value.rows) ? value.rows : [];
  const rows = rowsRaw
    .map((row) => parseComparisonRow(row))
    .filter((row): row is BarcodeComparisonRow => Boolean(row));
  const summary = parseComparisonSummary(value.summary);
  const libraryRaw = (value.library && typeof value.library === 'object'
    ? value.library
    : {}) as Record<string, unknown>;
  const library = {
    entriesCount:
      typeof libraryRaw.entries_count === 'number' && Number.isFinite(libraryRaw.entries_count)
        ? libraryRaw.entries_count
        : 0,
    missedByOcrCount:
      typeof libraryRaw.missed_by_ocr_count === 'number' && Number.isFinite(libraryRaw.missed_by_ocr_count)
        ? libraryRaw.missed_by_ocr_count
        : 0,
    missedByOcr: parseBarcodeOnlyEntries(libraryRaw.missed_by_ocr),
  };

  const barcodeText = typeof value.barcode_text === 'string' ? value.barcode_text : '';

  return { rows, summary, library, barcodeText };
}

export async function compareBarcodeData(
  kv: Record<string, unknown> | null | undefined,
  extraction: BarcodeExtractionResult,
): Promise<BarcodeComparisonReport | null> {
  if (!fs.existsSync(BARCODE_MATCH_SCRIPT)) {
    return null;
  }

  const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'barcode-match-'));
  const barcodeJsonPath = path.join(tmpDir, 'barcode.json');
  const ocrJsonPath = path.join(tmpDir, 'ocr.json');

  try {
    const barcodePayload = extraction.entries.map((entry) => ({
      text: entry.text,
      format: entry.format,
      symbology_identifier: entry.symbologyIdentifier,
      is_gs1: entry.isGs1,
      position: entry.position ?? undefined,
    }));
    await fsPromises.writeFile(barcodeJsonPath, JSON.stringify(barcodePayload, null, 2), 'utf-8');
    await fsPromises.writeFile(ocrJsonPath, JSON.stringify(kv ?? {}, null, 2), 'utf-8');

    const { stdout, stderr, code } = await runPythonScript(
      BARCODE_MATCH_SCRIPT,
      [barcodeJsonPath, ocrJsonPath],
      MATCH_TIMEOUT_MS,
    );

    if (code !== 0) {
      console.warn('Barcode/OCR matcher exited with non-zero code', { code, stderr });
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout || '{}');
    } catch (err) {
      console.warn('Failed to parse barcode matcher output', err);
      return null;
    }

    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const maybeError = (parsed as { error?: unknown }).error;
      if (typeof maybeError === 'string') {
        console.warn('Barcode matcher reported error', maybeError);
      }
      return null;
    }

    return parseComparisonReport(parsed);
  } catch (err) {
    console.warn('Failed to run barcode/OCR matcher', err);
    return null;
  } finally {
    await fsPromises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export function buildBarcodeValidation(
  kv: Record<string, unknown> | undefined | null,
  extraction: BarcodeExtractionResult,
  comparison: BarcodeComparisonReport | null,
): BarcodeValidationResult {
  const barcodeValues = extraction.entries
    .map((entry) => entry.text)
    .filter((text) => typeof text === 'string' && text.trim().length > 0);
  const comparedValue = barcodeValues.join(', ');

  if (barcodeValues.length === 0) {
    return {
      matches: null,
      status: 'no_barcode',
      message: 'No barcode values detected to validate against.',
    };
  }

  const hasOcrContent = kv && Object.values(kv).some((value) => isMeaningfulOcrValue(value));
  if (!hasOcrContent) {
    return {
      matches: null,
      status: 'missing_item_code',
      message: 'OCR extraction did not produce values that could be compared to barcode data.',
      comparedValue,
    };
  }

  if (!comparison) {
    return {
      matches: null,
      status: 'mismatch',
      message: 'Unable to compare OCR data to barcode values.',
      comparedValue,
    };
  }

  const { matched, mismatched, missing } = comparison.summary;
  const hasMatches = matched > 0;
  const hasDisagreements = mismatched > 0 || missing > 0;

  if (hasMatches && !hasDisagreements) {
    return {
      matches: true,
      status: 'match',
      message: matched === 1 ? '1 field matched barcode data.' : `${matched} fields matched barcode data.`,
      comparedValue,
    };
  }

  const parts: string[] = [];
  if (matched > 0) parts.push(`${matched} match${matched === 1 ? '' : 'es'}`);
  if (mismatched > 0) parts.push(`${mismatched} mismatch${mismatched === 1 ? '' : 'es'}`);
  if (missing > 0) parts.push(`${missing} missing`);
  const detail = parts.length > 0 ? parts.join(', ') : 'no comparable fields';

  return {
    matches: false,
    status: 'mismatch',
    message: `Barcode comparison resulted in ${detail}.`,
    comparedValue,
  };
}
