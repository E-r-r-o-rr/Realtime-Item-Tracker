import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

describe("json helpers", () => {
  it("reads valid JSON bodies", async () => {
    const { readJsonBody, safeParseJson } = await import("@/lib/json");
    const request = new Request("http://localhost/test", {
      method: "POST",
      body: JSON.stringify({ ok: true }),
    });
    const parsed = await readJsonBody(request, { ok: false });
    assert.deepEqual(parsed, { ok: true });

    const safe = safeParseJson("{\"value\":1}", { value: 0 });
    assert.deepEqual(safe, { value: 1 });
  });

  it("returns fallbacks and logs errors for invalid JSON", async () => {
    const { readJsonBody, safeParseJson } = await import(`@/lib/json?bad-${Date.now()}`);

    const error = mock.method(console, "error", mock.fn());

    const badRequest = new Request("http://localhost/test", {
      method: "POST",
      body: "{invalid",
    });

    const fallback = await readJsonBody(badRequest, { ok: false }, "navigation payload");
    assert.deepEqual(fallback, { ok: false });

    const safe = safeParseJson("", { ok: true }, "context");
    assert.deepEqual(safe, { ok: true });

    assert.ok(error.mock.calls.some(({ arguments: args }) => /navigation payload/.test(String(args[0]))));
  });
});
