import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  SESSION_COOKIE_NAME,
  SESSION_DURATION_SECONDS,
  createExpiredSessionCookie,
  createSession,
  createSessionCookie,
  getAllowedCredentials,
  getSessionFromCookies,
  verifySession,
} from "@/lib/auth";

const originalEnv = {
  AUTH_USERNAME: process.env.AUTH_USERNAME,
  AUTH_PASSWORD: process.env.AUTH_PASSWORD,
  AUTH_SECRET: process.env.AUTH_SECRET,
};

const originalDateNow = Date.now;

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
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

describe("auth helpers", () => {
  it("returns default credentials when env variables are missing", () => {
    delete process.env.AUTH_USERNAME;
    delete process.env.AUTH_PASSWORD;

    const credentials = getAllowedCredentials();
    assert.equal(credentials.username, "admin");
    assert.equal(credentials.password, "admin");
  });

  it("uses configured credentials when provided", () => {
    process.env.AUTH_USERNAME = "tester";
    process.env.AUTH_PASSWORD = "secret";

    const credentials = getAllowedCredentials();
    assert.equal(credentials.username, "tester");
    assert.equal(credentials.password, "secret");
  });

  it("creates and verifies a session token", async () => {
    const fixedNow = 1_700_000_000_000;
    Date.now = () => fixedNow;

    const token = await createSession("admin");
    const session = await verifySession(token);

    assert.ok(session);
    assert.equal(session?.username, "admin");
    assert.ok((session?.iat ?? 0) >= fixedNow);
    assert.ok((session?.exp ?? 0) > fixedNow);
  });

  it("returns null for tampered signatures", async () => {
    const token = await createSession("admin");
    const [payload, signature] = token.split(".");
    const padded = signature.replace(/-/g, "+").replace(/_/g, "/");
    const paddingLength = (4 - (padded.length % 4)) % 4;
    const normalized = padded + "=".repeat(paddingLength);
    const bytes = Buffer.from(normalized, "base64");
    bytes[0] ^= 0xff;
    const tamperedSignature = Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    const invalidToken = `${payload}.${tamperedSignature}`;

    const session = await verifySession(invalidToken);
    assert.equal(session, null);
  });

  it("rejects expired sessions", async () => {
    const baseTime = 1_700_000_000_000;
    Date.now = () => baseTime;
    const token = await createSession("admin");

    Date.now = () => baseTime + SESSION_DURATION_SECONDS * 1000 + 1;
    const session = await verifySession(token);
    assert.equal(session, null);
  });

  it("reads sessions from a cookie store", async () => {
    const token = await createSession("admin");

    const cookieStore = {
      get(name: string) {
        if (name === SESSION_COOKIE_NAME) {
          return { name, value: token };
        }
        return undefined;
      },
    } satisfies Parameters<typeof getSessionFromCookies>[0];

    const session = await getSessionFromCookies(cookieStore);
    assert.ok(session);
    assert.equal(session?.username, "admin");
  });

  it("returns null when the session cookie is missing", async () => {
    const cookieStore = {
      get() {
        return undefined;
      },
    } satisfies Parameters<typeof getSessionFromCookies>[0];

    const session = await getSessionFromCookies(cookieStore);
    assert.equal(session, null);
  });

  it("creates persistent session cookies", async () => {
    const token = await createSession("admin");
    const cookie = createSessionCookie(token);

    assert.equal(cookie.name, SESSION_COOKIE_NAME);
    assert.equal(cookie.value, token);
    assert.equal(cookie.maxAge, SESSION_DURATION_SECONDS);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, "lax");
    assert.equal(cookie.path, "/");
  });

  it("creates expired session cookies for logout", () => {
    const cookie = createExpiredSessionCookie();

    assert.equal(cookie.name, SESSION_COOKIE_NAME);
    assert.equal(cookie.value, "");
    assert.equal(cookie.maxAge, 0);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, "lax");
    assert.equal(cookie.path, "/");
  });
});
