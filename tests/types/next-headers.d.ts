import type { TestCookieRecord } from "../stubs/next-headers";

declare module "next/headers" {
  type TestCookieStore = {
    get: (name: string) => { name: string; value: string } | undefined;
    set: (cookie: TestCookieRecord) => void;
  };

  /** @internal Test-only hook exposed by our stubs to control the cookie store */
  export function __setCookieStore(store: TestCookieStore | null): void;
}
