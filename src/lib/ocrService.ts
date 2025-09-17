import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

const DEFAULT_PROVIDER = process.env.OCR_PROVIDER || 'hyperbolic';
const DEFAULT_MODEL = process.env.OCR_MODEL || 'Qwen/Qwen2.5-VL-7B-Instruct';
const DEFAULT_LANG = process.env.OCR_LANG || 'en';

// Prefer explicit venv python; fall back to system python
const PY_BIN =
  process.env.OCR_PYTHON ||
  process.env.PYTHON_BIN ||
  (process.platform === 'win32' ? 'python' : 'python3');

const OCR_SCRIPT = path.join(process.cwd(), 'scripts', 'ocr_extract.py');

// 3–5 minutes is safer for first runs / model cold starts
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS || 180_000);

// Set OCR_KEEP=1 to keep tmp output for debugging
const KEEP_TMP = process.env.OCR_KEEP === '1';

function rmrf(p: string) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

/**
 * Extract key/value pairs using the Python OCR pipeline.
 * Falls back to a stub if the script fails or is missing.
 */
export async function extractKvPairs(filePath: string): Promise<Record<string, string>> {
  if (!fs.existsSync(OCR_SCRIPT)) {
    console.warn('[ocrService] Python script not found, returning stub.');
    return stubFromFilename(filePath);
  }

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-out-'));

  const args = [
    OCR_SCRIPT,
    '--image', filePath,
    '--out_dir', outDir,
    '--model', DEFAULT_MODEL,
    '--lang', DEFAULT_LANG,
    '--provider', DEFAULT_PROVIDER,
  ];

  const env = {
    ...process.env,
    HF_TOKEN: process.env.HF_TOKEN || '', // REQUIRED for both hyperbolic and hf-inference paths
  };

  let timer: NodeJS.Timeout | null = null;

  try {
    const { stdout, stderr, code, signal } = await new Promise<{
      stdout: string; stderr: string; code: number; signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      const child = spawn(PY_BIN, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';

      timer = setTimeout(() => {
        try { child.kill(); } catch {} // generic kill works cross-platform
      }, OCR_TIMEOUT_MS);

      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ stdout, stderr, code: code ?? 0, signal }));
    });

    if (timer) { clearTimeout(timer); timer = null; }

    if (code !== 0) {
      console.warn('[ocrService] OCR script non-zero exit', { code, signal });
      if (stderr) console.warn('[ocrService] stderr:\n' + stderr);
      return stubFromFilename(filePath);
    }

    const structuredPath = path.join(outDir, 'structured.json');
    if (fs.existsSync(structuredPath)) {
      const payload = JSON.parse(fs.readFileSync(structuredPath, 'utf-8'));
      // Python writes an array with a single record: { image, llm_raw, llm_parsed }
      if (Array.isArray(payload) && payload.length > 0 && payload[0]?.llm_parsed) {
        return payload[0].llm_parsed as Record<string, string>;
      }
    }

    console.warn('[ocrService] structured.json missing or invalid. stderr:\n' + (stderr || '(empty)'));
    return stubFromFilename(filePath);
  } catch (err) {
    if (timer) { clearTimeout(timer); }
    console.warn('[ocrService] Error running OCR script:', err);
    return stubFromFilename(filePath);
  } finally {
    if (!KEEP_TMP) rmrf(outDir);
    else console.log('[ocrService] Keeping temp OCR output at:', outDir);
  }
}

function stubFromFilename(filePath: string): Record<string, string> {
  const basename = path.basename(filePath).toLowerCase();
  const code = basename.replace(/[^a-z0-9]+/g, '').slice(0, 6) || randomUUID().slice(0, 6);
  return {
    item_code: code.toUpperCase(),
    customer: 'Unknown Customer',
    order_date: new Date().toISOString().slice(0, 10),
  };
}
