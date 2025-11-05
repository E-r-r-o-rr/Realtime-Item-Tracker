import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { SESSION_COOKIE_NAME, SESSION_DURATION_SECONDS, createSession } from "@/lib/auth";

function createMockRequest(
  pathname: string,
  options: {
    search?: string;
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
  } = {},
) {
  const url = new URL(`https://example.test${pathname}${options.search ?? ""}`);
  const cookieMap = new Map(Object.entries(options.cookies ?? {}));
  const headers = new Headers(options.headers ?? {});

  const clone = () => {
    const cloned = new URL(url);
    (cloned as any).clone = clone;
    return cloned;
  };

  const nextUrl = new URL(url) as URL & { clone: typeof clone };
  (nextUrl as any).clone = clone;

  return {
    nextUrl,
    url: url.toString(),
    headers,
    cookies: {
      get(name: string) {
        const value = cookieMap.get(name);
        return value ? { name, value } : undefined;
      },
    },
  } as unknown;
}

const originalEnv = {
  API_KEY: process.env.API_KEY,
};

const originalDateNow = Date.now;

function restoreEnv() {
  if (originalEnv.API_KEY === undefined) {
    delete process.env.API_KEY;
  } else {
    process.env.API_KEY = originalEnv.API_KEY;
  }
}

beforeEach(() => {
  restoreEnv();
  Date.now = originalDateNow;
});

afterEach(() => {
  restoreEnv();
  Date.now = originalDateNow;
});

async function importMiddleware() {
  return import(`@/middleware.ts?t=${Date.now()}-${Math.random()}`);
}

describe("middleware authentication", () => {
  it("redirects unauthenticated users to the login page", async () => {
    const { middleware } = await importMiddleware();
    const request = createMockRequest("/storage");

    const response = await middleware(request as any);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "https://example.test/login?next=%2Fstorage");
  });

  it("returns 401 for unauthorized API access", async () => {
    const { middleware } = await importMiddleware();
    const request = createMockRequest("/api/storage");

    const response = await middleware(request as any);
    assert.equal(response.status, 401);
    const data = (await response.json()) as { error: string };
    assert.equal(data.error, "unauthorized");
  });

  it("allows public login route without authentication", async () => {
    const { middleware } = await importMiddleware();
    const request = createMockRequest("/login");

    const response = await middleware(request as any);
    assert.equal(response.status, 200);
  });

  it("redirects authenticated users away from the login page", async () => {
    const { middleware } = await importMiddleware();
    const baseTime = 1_700_000_000_000;
    Date.now = () => baseTime;
    const token = await createSession("admin");
    const request = createMockRequest("/login", {
      cookies: { [SESSION_COOKIE_NAME]: token },
    });

    const response = await middleware(request as any);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "https://example.test/");
  });

  it("enforces API key requirements when configured", async () => {
    process.env.API_KEY = "secret";
    const { middleware } = await importMiddleware();
    const sessionToken = await createSession("admin");
    const unauthorized = await middleware(
      createMockRequest("/api/orders", {
        cookies: { [SESSION_COOKIE_NAME]: sessionToken },
      }) as any,
    );
    assert.equal(unauthorized.status, 401);

    const authorizedRequest = createMockRequest("/api/orders", {
      headers: { "x-api-key": "secret" },
      cookies: { [SESSION_COOKIE_NAME]: sessionToken },
    });
    const authorized = await middleware(authorizedRequest as any);
    assert.equal(authorized.status, 200);
  });

  it("rate limits excessive API calls", async () => {
    const { middleware } = await importMiddleware();
    const sessionToken = await createSession("admin");
    let rateLimited = false;

    for (let i = 0; i < 61; i += 1) {
      const response = await middleware(
        createMockRequest("/api/orders", {
          cookies: { [SESSION_COOKIE_NAME]: sessionToken },
        }) as any,
      );
      if (response.status === 429) {
        rateLimited = true;
        break;
      }
    }

    assert.equal(rateLimited, true);
  });

  it("renews session cookies when nearing expiration", async () => {
    const { middleware } = await importMiddleware();
    const baseTime = 1_700_000_000_000;
    Date.now = () => baseTime;
    const token = await createSession("admin");
    const halfLifeMs = (SESSION_DURATION_SECONDS * 1000) / 2;
    const nearExpiryTime = baseTime + SESSION_DURATION_SECONDS * 1000 - halfLifeMs + 1000;
    Date.now = () => nearExpiryTime;

    const request = createMockRequest("/api/data", {
      cookies: { [SESSION_COOKIE_NAME]: token },
    });

    const response = await middleware(request as any);
    const renewed = response.cookies.get(SESSION_COOKIE_NAME);

    assert.ok(renewed);
    assert.notEqual(renewed?.value, token);
  });
});
