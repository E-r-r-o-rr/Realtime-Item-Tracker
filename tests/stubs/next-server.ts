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

  static redirect(url: string | URL, init: ResponseInit & { status?: number } = {}) {
    const headers = new Headers(init.headers);
    const target = typeof url === "string" ? url : url.toString();
    headers.set("location", target);
    const status = init.status ?? 307;
    return new NextResponse(null, { ...init, status, headers });
  }

  static next(init: ResponseInit = {}) {
    return new NextResponse(null, { status: init.status ?? 200, headers: init.headers });
  }
}

export class NextRequest {}

export { NextResponse as default };
