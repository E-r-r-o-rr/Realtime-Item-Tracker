export type TestCookieRecord = {
  name: string;
  value: string;
  maxAge?: number;
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  path?: string;
};

type CookieStore = {
  get: (name: string) => { name: string; value: string } | undefined;
  set: (cookie: TestCookieRecord) => void;
};

let currentStore: CookieStore | null = null;

export function __setCookieStore(store: CookieStore | null) {
  currentStore = store;
}

export async function cookies() {
  if (!currentStore) {
    throw new Error("Test cookie store has not been configured");
  }
  return currentStore;
}
