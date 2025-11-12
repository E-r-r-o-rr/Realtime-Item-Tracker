// src/lib/api-client.ts
const API_ROUTE_PREFIX = "/api/";
const API_KEY_HEADER = "x-api-key";
const PUBLIC_API_KEY = process.env.NEXT_PUBLIC_API_KEY;

type FetchInput = RequestInfo | URL;

function shouldAttachKey(input: FetchInput): boolean {
  if (typeof input === "string") {
    return input.startsWith(API_ROUTE_PREFIX);
  }

  if (typeof Request !== "undefined" && input instanceof Request) {
    return shouldAttachKey(input.url);
  }

  if (input instanceof URL) {
    if (typeof window !== "undefined") {
      return (
        input.origin === window.location.origin &&
        input.pathname.startsWith(API_ROUTE_PREFIX)
      );
    }

    // When rendering on the server, assume any URL passed explicitly that
    // targets an API route should receive the key as well.
    return input.pathname.startsWith(API_ROUTE_PREFIX);
  }

  return false;
}

function withApiKey(init: RequestInit | undefined): RequestInit {
  if (!PUBLIC_API_KEY) {
    return init ?? {};
  }

  const headers = new Headers(init?.headers ?? {});

  if (!headers.has(API_KEY_HEADER)) {
    headers.set(API_KEY_HEADER, PUBLIC_API_KEY);
  }

  if (init) {
    return { ...init, headers };
  }

  return { headers };
}

export function apiFetch(input: FetchInput, init?: RequestInit) {
  if (!shouldAttachKey(input)) {
    return fetch(input, init);
  }

  return fetch(input, withApiKey(init));
}

export { API_KEY_HEADER };
