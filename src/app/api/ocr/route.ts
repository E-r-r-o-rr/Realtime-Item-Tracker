import { NextResponse } from 'next/server';
import { extractKvPairs } from '@/lib/ocrService';
import { buildBarcodeValidation, extractBarcodes } from '@/lib/barcodeService';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Handle POST requests to the OCR endpoint. This endpoint accepts a file
 * uploaded via multipart/form-data and returns the extracted key/value pairs
 * as JSON. Files are temporarily written to disk before invoking the OCR
 * service. After processing, the temporary file is deleted.
 */
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
    const kv = await extractKvPairs(tmpPath);
    const { barcodes, warnings: barcodeWarnings } = await extractBarcodes(tmpPath);
    const validation = buildBarcodeValidation(kv, barcodes);
    await fs.unlink(tmpPath);
    return NextResponse.json({ kv, barcodes, barcodeWarnings, validation });
  } catch (err: any) {
    console.error('OCR endpoint error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}