import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";

export type Session = {
  username: string;
  iat: number;
  exp: number;
};

export const SESSION_COOKIE_NAME = "rit_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 12; // 12 hours

const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "admin";
const DEFAULT_SECRET = "change-me";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function getSecret() {
  return process.env.AUTH_SECRET || DEFAULT_SECRET;
}

function getCrypto(): Crypto {
  const cryptoInstance = globalThis.crypto;
  if (!cryptoInstance || !cryptoInstance.subtle) {
    throw new Error("Web Crypto API is not available in this environment");
  }
  return cryptoInstance as Crypto;
}

let keyPromise: Promise<CryptoKey> | null = null;

async function getSigningKey() {
  if (!keyPromise) {
    keyPromise = getCrypto().subtle.importKey(
      "raw",
      encoder.encode(getSecret()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }
  return keyPromise;
}

function bytesToBase64(bytes: Uint8Array) {
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // Node.js fallback
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(base64: string) {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // Node.js fallback
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function toBase64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = base64.length % 4;
  const padded = padding === 0 ? base64 : base64 + "=".repeat(4 - padding);
  return base64ToBytes(padded);
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function getAllowedCredentials() {
  const username = process.env.AUTH_USERNAME?.trim() || DEFAULT_USERNAME;
  const password = process.env.AUTH_PASSWORD?.trim() || DEFAULT_PASSWORD;
  return { username, password };
}

export async function createSession(username: string): Promise<string> {
  const issuedAt = Date.now();
  const payload = {
    username,
    iat: issuedAt,
    exp: issuedAt + SESSION_DURATION_SECONDS * 1000,
  } satisfies Session;

  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await getSigningKey();
  const signatureBuffer = await getCrypto().subtle.sign("HMAC", key, encoder.encode(encodedPayload));
  const signature = toBase64Url(new Uint8Array(signatureBuffer));

  return `${encodedPayload}.${signature}`;
}

export async function verifySession(raw: string | undefined | null): Promise<Session | null> {
  if (!raw) return null;

  const [encodedPayload, signature] = raw.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = fromBase64Url(signature);
  } catch {
    return null;
  }

  const key = await getSigningKey();
  const isValid = await getCrypto().subtle.verify(
    "HMAC",
    key,
    toArrayBuffer(signatureBytes),
    encoder.encode(encodedPayload),
  );

  if (!isValid) {
    return null;
  }

  try {
    const payloadBytes = fromBase64Url(encodedPayload);
    const payload = JSON.parse(decoder.decode(payloadBytes)) as Session;
    if (!payload.username || typeof payload.exp !== "number") {
      return null;
    }

    if (payload.exp <= Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export async function getSessionFromCookies(
  cookieStore: Pick<ReadonlyRequestCookies, "get">
): Promise<Session | null> {
  const cookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return verifySession(cookie ?? null);
}

export function createExpiredSessionCookie() {
  return {
    name: SESSION_COOKIE_NAME,
    value: "",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export function createSessionCookie(sessionToken: string) {
  return {
    name: SESSION_COOKIE_NAME,
    value: sessionToken,
    maxAge: SESSION_DURATION_SECONDS,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}
