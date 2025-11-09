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

export function __setOcrRouteTestOverrides(overrides?: Partial<OcrRouteDependencies>) {
  deps = { ...defaultDeps, ...overrides };
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
    }
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-'));
    const tmpPath = path.join(tmpDir, file.name);
    await fs.writeFile(tmpPath, buffer);
    const { kv, selectedKv, providerInfo, error } = await deps.extractKvPairs(tmpPath);
    if (error) {
      await fs.unlink(tmpPath);
      return NextResponse.json({ error, providerInfo }, { status: 502 });
    }

    const barcodeExtraction = await deps.extractBarcodes(tmpPath);
    const barcodeComparison = await deps.compareBarcodeData(kv ?? {}, barcodeExtraction);
    const validation = deps.buildBarcodeValidation(kv, barcodeExtraction, barcodeComparison);
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
    });
  } catch (err: any) {
    console.error('OCR endpoint error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}