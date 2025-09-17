import { NextResponse } from 'next/server';

/**
 * Webhook receiver for MapReady events. This endpoint could be used by
 * downstream systems to subscribe to map-ready notifications. In this demo
 * implementation it simply logs the incoming payload and returns 200 OK.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.info('Received MapReady webhook:', body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
}