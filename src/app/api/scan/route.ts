import { NextResponse } from 'next/server';
import { extractKvPairs } from '@/lib/ocrService';
import { normalizeTicketData, saveScanResult } from '@/lib/scan';
import { bookingSamples } from '@/data/orderSamples';

async function parseMultipart(req: Request) {
  const formData = await req.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    throw new Error('Expected a file upload named "file".');
  }
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const tmp = await import('node:fs/promises');
  const { default: os } = await import('node:os');
  const { default: path } = await import('node:path');
  const tmpDir = await tmp.mkdtemp(path.join(os.tmpdir(), 'scan-'));
  const filePath = path.join(tmpDir, file.name);
  await tmp.writeFile(filePath, buffer);
  try {
    return await extractKvPairs(filePath);
  } finally {
    await tmp.rm(tmpDir, { recursive: true, force: true });
  }
}

async function parseJson(req: Request) {
  const body = await req.json();
  if (body?.fields) {
    return body.fields as Record<string, string>;
  }
  if (body?.sampleTrackingId) {
    const sample = bookingSamples.find((order) => order.trackingId === body.sampleTrackingId);
    if (!sample) {
      throw new Error('Sample tracking ID not found.');
    }
    return {
      destination: sample.destination,
      item_name: sample.itemName,
      tracking_id: sample.trackingId,
      truck_number: sample.truckNumber,
      ship_date: sample.shipDate,
      expected_departure: sample.expectedDeparture,
      origin: sample.origin,
    } as Record<string, string>;
  }
  throw new Error('Unsupported JSON payload for scan.');
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') || '';
    let kv: Record<string, string>;
    if (contentType.includes('multipart/form-data')) {
      kv = await parseMultipart(req);
    } else if (contentType.includes('application/json')) {
      kv = await parseJson(req);
    } else {
      throw new Error('Unsupported content type. Use multipart/form-data or JSON.');
    }

    const normalized = normalizeTicketData(kv);
    const currentScan = saveScanResult(normalized);
    return NextResponse.json({ currentScan, normalized });
  } catch (error: any) {
    console.error('Scan error:', error);
    return NextResponse.json({ error: error.message || 'Failed to process scan.' }, { status: 400 });
  }
}
