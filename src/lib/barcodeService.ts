import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const PY_BIN =
  process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
const BARCODE_SCRIPT = path.join(process.cwd(), 'scripts', 'barcode_decode.py');
const BARCODE_TIMEOUT_MS = Number(process.env.BARCODE_TIMEOUT_MS || 30_000);

export interface BarcodeExtractionResult {
  barcodes: string[];
  warnings: string[];
}

function normalizeBarcodeValue(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase();
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
  kv: Record<string, string>,
  barcodes: string[],
): {
  matches: boolean | null;
  status: 'match' | 'mismatch' | 'no_barcode' | 'missing_item_code';
  message: string;
  comparedValue?: string;
} {
  if (!barcodes.length) {
    return {
      matches: null,
      status: 'no_barcode',
      message: 'No barcode values detected to validate against.',
    };
  }

  const itemCode = kv?.item_code;
  if (!itemCode) {
    return {
      matches: null,
      status: 'missing_item_code',
      message: 'OCR extraction did not produce an item code to compare with barcode data.',
    };
  }

  const normalizedItem = normalizeBarcodeValue(itemCode);
  const normalizedBarcodes = barcodes.map((code) => normalizeBarcodeValue(code));
  const matched = normalizedBarcodes.includes(normalizedItem);

  return {
    matches: matched,
    status: matched ? 'match' : 'mismatch',
    comparedValue: barcodes.join(', '),
    message: matched
      ? 'OCR item code matches the detected barcode value.'
      : `OCR item code ${itemCode} does not match barcode value(s): ${barcodes.join(', ')}.`,
  };
}
