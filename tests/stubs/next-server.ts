class ResponseCookies {
  #store = new Map<string, Record<string, unknown>>();

  set(cookie: Record<string, unknown> & { name: string; value: string }) {
    this.#store.set(cookie.name, cookie);
  }

  get(name: string) {
    const entry = this.#store.get(name);
    return entry ? { name, value: entry.value as string } : undefined;
  }

  getAll() {
    return Array.from(this.#store.values());
  }
}

export class NextResponse extends Response {
  cookies: ResponseCookies;

  constructor(body?: BodyInit | null, init: ResponseInit = {}) {
    super(body ?? null, init);
    this.cookies = new ResponseCookies();
  }

  static json(data: unknown, init: ResponseInit & { status?: number } = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return new NextResponse(JSON.stringify(data), { ...init, headers });
  }

  static redirect(url: string | URL, status?: number): NextResponse;
  static redirect(
    url: string | URL,
    init?: ResponseInit & { status?: number }
  ): NextResponse;
  static redirect(
    url: string | URL,
    initOrStatus: number | (ResponseInit & { status?: number }) = 307
  ) {
    const isStatusNumber = typeof initOrStatus === "number";
    const headers = new Headers(isStatusNumber ? undefined : initOrStatus.headers);

    const target = typeof url === "string" ? url : url.toString();
    headers.set("location", target);

    const status = isStatusNumber
      ? initOrStatus
      : initOrStatus.status ?? 307;

    const init = isStatusNumber
      ? { status, headers }
      : { ...initOrStatus, status, headers };

    return new NextResponse(null, init);
  }

  static next(init: ResponseInit = {}) {
    return new NextResponse(null, { status: init.status ?? 200, headers: init.headers });
  }
}

export class NextRequest {}

export { NextResponse as default };
