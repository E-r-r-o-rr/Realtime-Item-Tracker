// src/middleware.ts
import { NextRequest, NextResponse } from "next/server";

import {
  SESSION_COOKIE_NAME,
  SESSION_DURATION_SECONDS,
  createSession,
  createSessionCookie,
  verifySession,
} from "@/lib/auth";

// In-memory limiter (okay for dev; use a shared store in prod)
type RateLimitBucket = { count: number; start: number };

const rateLimitStore: Map<string, RateLimitBucket> = new Map();
const MAX_REQUESTS = 60; // per window
const WINDOW_MS = 60_000; // 1 minute

const PUBLIC_PATHS = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/healthz",
]);

const PUBLIC_PREFIXES = ["/_next/", "/static/", "/images/", "/favicon"];

function getClientKey(req: NextRequest, sessionToken: string | null) {
  const keyParts: string[] = [];

  if (sessionToken) {
    keyParts.push(`s:${sessionToken}`);
  }

  const apiKey = req.headers.get("x-api-key") ?? req.nextUrl.searchParams.get("api_key");
  if (apiKey) {
    keyParts.push(`k:${apiKey}`);
  }

  if (keyParts.length > 0) {
    return keyParts.join("|");
  }

  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const real = req.headers.get("x-real-ip") ?? "";
  const cf = req.headers.get("cf-connecting-ip") ?? "";
  const ip = fwd.split(",")[0]?.trim() || real || cf || "unknown";
  return `ip:${ip}`;
}

function touchRateLimitBucket(key: string, now: number) {
  const bucket = rateLimitStore.get(key);

  if (!bucket) {
    rateLimitStore.set(key, { count: 1, start: now });
    return { limited: false } as const;
  }

  if (now - bucket.start > WINDOW_MS) {
    rateLimitStore.set(key, { count: 1, start: now });
    return { limited: false } as const;
  }

  const nextCount = bucket.count + 1;
  const updatedBucket: RateLimitBucket = { count: nextCount, start: bucket.start };
  rateLimitStore.set(key, updatedBucket);

  return { limited: nextCount > MAX_REQUESTS } as const;
}

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) {
    return true;
  }

  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function buildLoginRedirect(req: NextRequest) {
  const loginUrl = new URL("/login", req.url);
  const nextPath = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  if (nextPath && nextPath !== "/login") {
    loginUrl.searchParams.set("next", nextPath);
  }
  return loginUrl;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApiRoute = pathname.startsWith("/api");

  if (pathname.startsWith("/api/healthz")) {
    return NextResponse.next();
  }

  const sessionToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySession(sessionToken ?? null);
  const isAuthenticated = Boolean(session);

  if (!isAuthenticated && !isPublicPath(pathname)) {
    if (isApiRoute) {
      return new NextResponse(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    return NextResponse.redirect(buildLoginRedirect(req));
  }

  if (isAuthenticated && pathname === "/login") {
    const nextUrl = req.nextUrl.clone();
    nextUrl.pathname = "/";
    nextUrl.search = "";
    return NextResponse.redirect(nextUrl);
  }

  if (isApiRoute && !pathname.startsWith("/api/auth/")) {
    const requiredKey = process.env.API_KEY;
    if (requiredKey) {
      const provided =
        req.headers.get("x-api-key") ?? req.nextUrl.searchParams.get("api_key") ?? "";
      if (provided !== requiredKey) {
        return new NextResponse(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
    }
  }

  if (isApiRoute) {
    const key = getClientKey(req, sessionToken ?? null);
    const { limited } = touchRateLimitBucket(key, Date.now());
    if (limited) {
      return new NextResponse(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }
  }

  const response = NextResponse.next();

  if (session) {
    const remainingMs = session.exp - Date.now();
    const halfLifeMs = (SESSION_DURATION_SECONDS * 1000) / 2;
    if (remainingMs < halfLifeMs) {
      const renewedToken = await createSession(session.username);
      const cookie = createSessionCookie(renewedToken);
      response.cookies.set(cookie);
    }
  }

  return response;
}

export const config = {
  matcher: ["/(.*)"],
};
