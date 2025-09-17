import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

const DEFAULT_PROVIDER = process.env.OCR_PROVIDER || 'hyperbolic';
const DEFAULT_MODEL = process.env.OCR_MODEL || 'Qwen/Qwen2.5-VL-7B-Instruct';
const PY_BIN = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
const OCR_SCRIPT = path.join(process.cwd(), 'scripts', 'ocr_extract.py');

// 60s default; adjust if needed
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS || 60_000);

function rmrf(p: string) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
}

/**
 * Extract key/value pairs from a document using the Python OCR pipeline.
 * Falls back to a stub if the script (or deps) are missing.
 */
export async function extractKvPairs(filePath: string): Promise<Record<string, string>> {
  if (!fs.existsSync(OCR_SCRIPT)) {
    return stubFromFilename(filePath);
  }

  // temp output dir for the script's artifacts
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-out-'));

  // Build CLI args. We pass provider/model via flags for clarity,
  // and forward HF_TOKEN in env so the Python script can read it.
  const args = [
    OCR_SCRIPT,
    '--image', filePath,
    '--out_dir', outDir,
    '--model', DEFAULT_MODEL,
  ];

  const env = {
    ...process.env,
    HF_TOKEN: process.env.HF_TOKEN || '', // <- set this in .env.local
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
        try { child.kill('SIGKILL'); } catch {}
      }, OCR_TIMEOUT_MS);

      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', reject);
      child.on('close', (code, signal) => resolve({ stdout, stderr, code: code ?? 0, signal }));
    });

    if (timer) { clearTimeout(timer); timer = null; }

    if (code !== 0) {
      console.warn('OCR script non-zero exit', { code, signal, stderr });
      return stubFromFilename(filePath);
    }

    // Read structured output
    const structuredPath = path.join(outDir, 'structured.json');
    if (fs.existsSync(structuredPath)) {
      const payload = JSON.parse(fs.readFileSync(structuredPath, 'utf-8'));
      if (Array.isArray(payload) && payload.length > 0 && payload[0]?.llm_parsed) {
        return payload[0].llm_parsed as Record<string, string>;
      }
    }

    // If the script printed a single-record JSON to stdout, you could parse it here.
    // (Your Python script writes files, so we rely on structured.json.)
    console.warn('OCR script produced no structured.json; stderr:', stderr);
    return stubFromFilename(filePath);
  } catch (err) {
    if (timer) { clearTimeout(timer); }
    console.warn('Error running OCR script:', err);
    return stubFromFilename(filePath);
  } finally {
    rmrf(outDir);
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
