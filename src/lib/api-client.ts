// src/lib/api-client.ts
const API_ROUTE_PREFIX = "/api/";
const API_KEY_HEADER = "x-api-key";

const PUBLIC_API_KEY =
  process.env.NEXT_PUBLIC_API_KEY ?? (typeof window === "undefined" ? process.env.API_KEY : undefined);

type FetchInput = RequestInfo | URL;

function shouldAttachKey(input: FetchInput): boolean {
  if (typeof input === "string") {
    if (input.startsWith(API_ROUTE_PREFIX)) {
      return true;
    }

    if (input.startsWith("http://") || input.startsWith("https://")) {
      try {
        return shouldAttachKey(new URL(input));
      } catch {
        return false;
      }
    }

    return false;
  }

  if (typeof Request !== "undefined" && input instanceof Request) {
    return shouldAttachKey(input.url);
  }

  if (input instanceof URL) {
    if (typeof window !== "undefined") {
      if (input.origin !== window.location.origin) {
        return false;
      }
    }

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
