import { NextResponse } from 'next/server';

/**
 * Health check endpoint. Returns a JSON object indicating the service is
 * healthy. Use this endpoint with liveness probes in your deployment.
 */
export async function GET() {
  return NextResponse.json({ status: 'ok' });
}