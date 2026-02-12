import { NextResponse } from 'next/server';
import { extractKvPairs } from '@/lib/ocrService';
import {
  buildBarcodeValidation,
  compareBarcodeData,
  extractBarcodes,
} from '@/lib/barcodeService';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export const runtime = 'nodejs';
export const config = {
  api: {
    bodyParser: false,
    sizeLimit: '25mb',
  },
};

/**
 * Handle POST requests to the OCR endpoint. This endpoint accepts a file
 * uploaded via multipart/form-data and returns the extracted key/value pairs
 * as JSON. Files are temporarily written to disk before invoking the OCR
 * service. After processing, the temporary file is deleted.
 */
type OcrProfile = 'fast' | 'balanced' | 'accurate';

const parseProfile = (value: FormDataEntryValue | null): OcrProfile => {
  if (typeof value !== 'string') return 'balanced';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'fast' || normalized === 'accurate') return normalized;
  return 'balanced';
};

type OcrRouteDependencies = {
  extractKvPairs: typeof extractKvPairs;
  extractBarcodes: typeof extractBarcodes;
  compareBarcodeData: typeof compareBarcodeData;
  buildBarcodeValidation: typeof buildBarcodeValidation;
};

const defaultDeps: OcrRouteDependencies = {
  extractKvPairs,
  extractBarcodes,
  compareBarcodeData,
  buildBarcodeValidation,
};

let deps: OcrRouteDependencies = { ...defaultDeps };

const applyOverrides = (overrides?: Partial<OcrRouteDependencies>) => {
  deps = overrides ? { ...defaultDeps, ...overrides } : { ...defaultDeps };
};

declare global {
  var __setOcrRouteTestOverrides:
    | ((overrides?: Partial<OcrRouteDependencies>) => void)
    | undefined;
}

if (process.env.NODE_ENV === 'test') {
  globalThis.__setOcrRouteTestOverrides = applyOverrides;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    const profile = parseProfile(formData.get('ocrProfile'));
    const disableBarcode =
      (() => {
        const flag = formData.get('barcodeDisabled');
        if (typeof flag === 'string') {
          return flag.toLowerCase() === 'true';
        }
        if (typeof flag === 'number') {
          return Number(flag) === 1;
        }
        return false;
      })();
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
    }
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-'));
    const tmpPath = path.join(tmpDir, file.name);
    await fs.writeFile(tmpPath, buffer);
    const { kv, selectedKv, providerInfo, error } = await deps.extractKvPairs(tmpPath, { profile });
    if (error) {
      await fs.unlink(tmpPath);
      return NextResponse.json({ error, providerInfo }, { status: 502 });
    }

    let barcodeExtraction = { entries: [], warnings: [] } as Awaited<
      ReturnType<typeof deps.extractBarcodes>
    >;
    let barcodeComparison: Awaited<ReturnType<typeof deps.compareBarcodeData>> = null;
    let validation = null as Awaited<ReturnType<typeof deps.buildBarcodeValidation>> | null;

    if (!disableBarcode) {
      barcodeExtraction = await deps.extractBarcodes(tmpPath);
      barcodeComparison = await deps.compareBarcodeData(kv ?? {}, barcodeExtraction);
      validation = deps.buildBarcodeValidation(kv, barcodeExtraction, barcodeComparison);
    } else {
      validation = {
        matches: null,
        status: 'disabled',
        message: 'Barcode validation disabled for this scan.',
      };
    }

    const barcodes = barcodeExtraction.entries.map((entry) => entry.text).filter((text) => text.trim().length > 0);
    const barcodeWarnings = barcodeExtraction.warnings;
    await fs.unlink(tmpPath);
    return NextResponse.json({
      kv,
      selectedKv,
      barcodes,
      barcodeWarnings,
      barcodeComparison,
      validation,
      providerInfo,
      profile,
    });
  } catch (err: any) {
    console.error('OCR endpoint error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}