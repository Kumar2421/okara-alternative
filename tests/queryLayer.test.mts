import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, fetchJson } from "../lib/query/fetchJson.ts";
import { qk } from "../lib/query/keys.ts";
import { shouldRetry } from "../lib/query/retry.ts";

function mockFetch(handler: () => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = (() => handler()) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("fetchJson returns parsed JSON on success", async () => {
  const restore = mockFetch(async () => json({ ok: true }));
  try {
    assert.deepEqual(await fetchJson("/x"), { ok: true });
  } finally {
    restore();
  }
});

test("fetchJson throws ApiError with the server message and status", async () => {
  const restore = mockFetch(async () => json({ error: "Google isn't connected" }, 422));
  try {
    await assert.rejects(fetchJson("/x"), (err: unknown) => err instanceof ApiError && err.status === 422 && err.message === "Google isn't connected");
  } finally {
    restore();
  }
});

test("fetchJson survives a non-JSON error body", async () => {
  const restore = mockFetch(async () => new Response("<html>bad gateway</html>", { status: 502 }));
  try {
    await assert.rejects(fetchJson("/x"), (err: unknown) => err instanceof ApiError && err.status === 502 && /502/.test(err.message));
  } finally {
    restore();
  }
});

test("fetchJson reports a network failure as status 0", async () => {
  const restore = mockFetch(async () => {
    throw new TypeError("fetch failed");
  });
  try {
    await assert.rejects(fetchJson("/x"), (err: unknown) => err instanceof ApiError && err.status === 0);
  } finally {
    restore();
  }
});

test("shouldRetry: never retries client errors, retries flaky ones at most twice", () => {
  assert.equal(shouldRetry(0, new ApiError("not connected", 422)), false);
  assert.equal(shouldRetry(0, new ApiError("not found", 404)), false);
  assert.equal(shouldRetry(0, new ApiError("boom", 500)), true);
  assert.equal(shouldRetry(1, new ApiError("offline", 0)), true);
  assert.equal(shouldRetry(2, new ApiError("boom", 500)), false);
  assert.equal(shouldRetry(0, new Error("whatever")), true);
});

test("query keys are scoped by project so projects never share cache entries", () => {
  assert.notDeepEqual(qk.traffic("a"), qk.traffic("b"));
  assert.notDeepEqual(qk.googleResources("a"), qk.googleResources("b"));
  assert.deepEqual(qk.traffic("a").slice(0, 2), ["project", "a"]);
  assert.deepEqual(qk.project("a"), ["project", "a"]);
});

test("every project key starts with the project prefix, so one prefix can refresh a whole project", () => {
  const prefix = qk.project("p1");
  for (const key of [qk.dashboardData("p1"), qk.audit("p1", "https://x.com", 2), qk.links("p1"), qk.geo("p1"), qk.siteCrawl("p1"), qk.traffic("p1"), qk.googleResources("p1"), qk.searchHistory("p1"), qk.searchOpportunities("p1")]) {
    assert.deepEqual(key.slice(0, 2), prefix);
  }
});

test("audit key changes with the url and the audit version (so a finished crawl refetches)", () => {
  assert.notDeepEqual(qk.audit("p", "https://x.com", 0), qk.audit("p", "https://x.com", 1));
  assert.notDeepEqual(qk.audit("p", "https://x.com", 0), qk.audit("p", "https://y.com", 0));
});
