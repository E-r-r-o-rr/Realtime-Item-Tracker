// src/middleware.ts
import { NextRequest, NextResponse } from 'next/server';

// In-memory limiter (okay for dev; use a shared store in prod)
const rateLimitStore: Map<string, { count: number; start: number }> = new Map();
const MAX_REQUESTS = 60;           // per window
const WINDOW_MS = 60_000;          // 1 minute

function getClientKey(req: NextRequest) {
  // Prefer API key if present so team members don't share the same bucket
  const apiKey = req.headers.get('x-api-key') ?? req.nextUrl.searchParams.get('api_key');
  if (apiKey) return `k:${apiKey}`;

  // Fallback to forwarded IP chain (first is client)
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  const real = req.headers.get('x-real-ip') ?? '';
  const cf = req.headers.get('cf-connecting-ip') ?? '';
  const ip = fwd.split(',')[0]?.trim() || real || cf || 'unknown';
  return `ip:${ip}`;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow health checks without auth/limits
  if (pathname.startsWith('/api/healthz')) {
    return NextResponse.next();
  }

  // ---- API key auth (if configured) ----
  const requiredKey = process.env.API_KEY;
  if (pathname.startsWith('/api') && requiredKey) {
    const provided =
      req.headers.get('x-api-key') ?? req.nextUrl.searchParams.get('api_key') ?? '';
    if (provided !== requiredKey) {
      return new NextResponse(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  // ---- Basic rate limit ----
  const key = getClientKey(req);
  const now = Date.now();
  const bucket = rateLimitStore.get(key);

  if (!bucket || now - bucket.start > WINDOW_MS) {
    rateLimitStore.set(key, { count: 1, start: now });
  } else {
    bucket.count += 1;
    if (bucket.count > MAX_REQUESTS) {
      return new NextResponse(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  return NextResponse.next();
}

// Limit to API routes (adjust as you like)
export const config = {
  matcher: ['/api/:path*'],
};
