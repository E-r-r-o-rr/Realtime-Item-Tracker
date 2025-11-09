import assert from "node:assert/strict";
import { describe, it } from "node:test";

const importFreshRoute = async () =>
  import(`../../src/app/api/navigation/start/route.ts?test=${Date.now()}-${Math.random()}`) as Promise<
    typeof import("../../src/app/api/navigation/start/route")
  >;

describe("POST /api/navigation/start", () => {
  it("rejects missing payloads", async () => {
    const { POST } = await importFreshRoute();
    const request = new Request("https://example.test/api/navigation/start", {
      method: "POST",
      body: "",
    });

    const response = await POST(request as any);
    assert.equal(response.status, 400);
    const data = (await response.json()) as { error: string };
    assert.equal(data.error, "Navigation payload is required");
  });

  it("rejects malformed JSON payloads", async () => {
    const { POST } = await importFreshRoute();
    const request = new Request("https://example.test/api/navigation/start", {
      method: "POST",
      body: "{not-json}",
    });

    const response = await POST(request as any);
    assert.equal(response.status, 400);
    const data = (await response.json()) as { error: string };
    assert.equal(data.error, "Navigation payload is required");
  });

  it("queues navigation requests with a timestamp", async () => {
    const { POST } = await importFreshRoute();
    const request = new Request("https://example.test/api/navigation/start", {
      method: "POST",
      body: JSON.stringify({ target: "R1-A" }),
      headers: { "content-type": "application/json" },
    });

    const response = await POST(request as any);
    assert.equal(response.status, 200);
    const data = (await response.json()) as { status: string; received_at: string; payload: unknown };
    assert.equal(data.status, "queued");
    assert.ok(Date.parse(data.received_at));
    assert.deepEqual(data.payload, { target: "R1-A" });
  });
});
