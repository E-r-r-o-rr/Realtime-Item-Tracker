import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { SESSION_COOKIE_NAME, SESSION_DURATION_SECONDS } from "@/lib/auth";
import { __setCookieStore } from "next/headers";

type MockCookieRecord = {
  name: string;
  value: string;
  maxAge?: number;
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  path?: string;
};

type MockCookieStore = {
  get: (name: string) => { name: string; value: string } | undefined;
  set: (cookie: MockCookieRecord) => void;
  lastSet: MockCookieRecord | null;
  setCalls: number;
};

let cookieStore: MockCookieStore;

function createCookieStore(): MockCookieStore {
  const store = new Map<string, MockCookieRecord>();
  return {
    get(name) {
      const record = store.get(name);
      return record ? { name, value: record.value } : undefined;
    },
    set(cookie) {
      store.set(cookie.name, cookie);
      this.lastSet = cookie;
      this.setCalls += 1;
    },
    lastSet: null,
    setCalls: 0,
  };
}

const originalEnv = {
  AUTH_USERNAME: process.env.AUTH_USERNAME,
  AUTH_PASSWORD: process.env.AUTH_PASSWORD,
};

function restoreEnv() {
  if (originalEnv.AUTH_USERNAME === undefined) {
    delete process.env.AUTH_USERNAME;
  } else {
    process.env.AUTH_USERNAME = originalEnv.AUTH_USERNAME;
  }

  if (originalEnv.AUTH_PASSWORD === undefined) {
    delete process.env.AUTH_PASSWORD;
  } else {
    process.env.AUTH_PASSWORD = originalEnv.AUTH_PASSWORD;
  }
}

async function importFresh<T>(specifier: string): Promise<T> {
  return import(`${specifier}?t=${Date.now()}-${Math.random()}`) as Promise<T>;
}

beforeEach(() => {
  restoreEnv();
  cookieStore = createCookieStore();
  __setCookieStore(cookieStore);
});

afterEach(() => {
  __setCookieStore(null);
  restoreEnv();
});

describe("auth login route", () => {
  it("returns 400 when credentials are missing", async () => {
    const { POST } = await importFresh<typeof import("@/app/api/auth/login/route")>(
      "@/app/api/auth/login/route",
    );

    const response = await POST(
      new Request("https://example.test/api/auth/login", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
    );

    assert.equal(response.status, 400);
    const data = (await response.json()) as { error: string };
    assert.equal(data.error, "missing_credentials");
    assert.equal(cookieStore.setCalls, 0);
  });

  it("rejects invalid credentials", async () => {
    const { POST } = await importFresh<typeof import("@/app/api/auth/login/route")>(
      "@/app/api/auth/login/route",
    );

    const response = await POST(
      new Request("https://example.test/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "admin", password: "wrong" }),
        headers: { "content-type": "application/json" },
      }),
    );

    assert.equal(response.status, 401);
    const data = (await response.json()) as { error: string };
    assert.equal(data.error, "invalid_credentials");
    assert.equal(cookieStore.setCalls, 0);
  });

  it("sets a session cookie on successful login", async () => {
    const { POST } = await importFresh<typeof import("@/app/api/auth/login/route")>(
      "@/app/api/auth/login/route",
    );

    const response = await POST(
      new Request("https://example.test/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: "admin", password: "admin" }),
        headers: { "content-type": "application/json" },
      }),
    );

    assert.equal(response.status, 200);
    const data = (await response.json()) as { success: boolean };
    assert.equal(data.success, true);
    assert.equal(cookieStore.setCalls, 1);
    assert.ok(cookieStore.lastSet);
    assert.equal(cookieStore.lastSet?.name, SESSION_COOKIE_NAME);
    assert.equal(cookieStore.lastSet?.maxAge, SESSION_DURATION_SECONDS);
    assert.equal(cookieStore.lastSet?.httpOnly, true);
  });

  it("handles malformed JSON payloads", async () => {
    const { POST } = await importFresh<typeof import("@/app/api/auth/login/route")>(
      "@/app/api/auth/login/route",
    );

    const response = await POST(
      new Request("https://example.test/api/auth/login", {
        method: "POST",
        body: "not-json",
      }),
    );

    assert.equal(response.status, 400);
    const data = (await response.json()) as { error: string };
    assert.equal(data.error, "invalid_request");
  });
});

describe("auth logout route", () => {
  it("expires the session cookie", async () => {
    const { POST } = await importFresh<typeof import("@/app/api/auth/logout/route")>(
      "@/app/api/auth/logout/route",
    );

    const response = await POST(new Request("https://example.test/api/auth/logout", { method: "POST" }));

    assert.equal(response.status, 200);
    const data = (await response.json()) as { success: boolean };
    assert.equal(data.success, true);
    assert.equal(cookieStore.setCalls, 1);
    assert.ok(cookieStore.lastSet);
    assert.equal(cookieStore.lastSet?.name, SESSION_COOKIE_NAME);
    assert.equal(cookieStore.lastSet?.maxAge, 0);
    assert.equal(cookieStore.lastSet?.value, "");
  });
});
