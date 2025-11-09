import assert from "node:assert/strict";
import { describe, it } from "node:test";

const importFreshRoute = async () =>
  import(`../../src/app/api/healthz/route.ts?test=${Date.now()}-${Math.random()}`) as Promise<
    typeof import("../../src/app/api/healthz/route")
  >;

describe("GET /api/healthz", () => {
  it("reports service status", async () => {
    const { GET } = await importFreshRoute();
    const response = await GET();
    assert.equal(response.status, 200);
    const data = (await response.json()) as { status: string };
    assert.equal(data.status, "ok");
    assert.equal(response.headers.get("content-type"), "application/json");
  });
});
