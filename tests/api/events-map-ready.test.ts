import assert from "node:assert/strict";
import { describe, it, mock, afterEach } from "node:test";

const importRoute = async () =>
  import(`../../src/app/api/events/map-ready/route.ts?test=${Date.now()}-${Math.random()}`) as Promise<
    typeof import("../../src/app/api/events/map-ready/route")
  >;

afterEach(() => {
  mock.restoreAll();
});

describe("POST /api/events/map-ready", () => {
  it("accepts valid JSON payloads", async () => {
    const { POST } = await importRoute();
    const info = mock.method(console, "info", mock.fn());
    const response = await POST(
      new Request("https://example.test/api/events/map-ready", {
        method: "POST",
        body: JSON.stringify({ mapId: "1", status: "ready" }),
        headers: { "content-type": "application/json" },
      }),
    );

    assert.equal(response.status, 200);
    const data = (await response.json()) as { ok: boolean };
    assert.equal(data.ok, true);
    assert.equal(info.mock.callCount(), 1);
  });

  it("rejects malformed JSON", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      new Request("https://example.test/api/events/map-ready", {
        method: "POST",
        body: "not-json",
      }),
    );

    assert.equal(response.status, 400);
    const data = (await response.json()) as { error: string };
    assert.equal(data.error, "Invalid payload");
  });
});
