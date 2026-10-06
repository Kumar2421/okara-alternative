import test from "node:test";
import assert from "node:assert/strict";
import { compareFingerprints, fetchPageFingerprint, isPublicHttpUrl, parseFingerprint } from "../lib/domain/search/pageFingerprint.ts";

const PAGE = `<html><head><title>Old Title</title><meta name="Description" content="  Old   description "></head>
<body><svg><title>icon</title></svg><h1>  Main
heading </h1><h1>Second</h1></body></html>`;

test("parseFingerprint reads title, description and first h1, collapsing whitespace", () => {
  assert.deepEqual(parseFingerprint(PAGE), { title: "Old Title", description: "Old description", h1: "Main heading" });
});

test("parseFingerprint tolerates missing parts", () => {
  assert.deepEqual(parseFingerprint("<html><body>hi</body></html>"), { title: "", description: "", h1: "" });
});

test("compareFingerprints reports exactly what changed", () => {
  const before = parseFingerprint(PAGE);
  const after = { ...before, title: "Best SEO Tool | Marlo" };
  const change = compareFingerprints(before, after);
  assert.equal(change?.changed, true);
  assert.deepEqual(change?.changes, [{ field: "title", before: "Old Title", after: "Best SEO Tool | Marlo" }]);
  assert.equal(compareFingerprints(before, { ...before })?.changed, false);
});

test("compareFingerprints needs both sides", () => {
  assert.equal(compareFingerprints(null, { title: "a", description: "", h1: "" }), null);
  assert.equal(compareFingerprints({ title: "a", description: "", h1: "" }, undefined), null);
});

test("isPublicHttpUrl accepts public pages and rejects local/private targets", () => {
  assert.equal(isPublicHttpUrl("https://example.com/page"), true);
  for (const bad of ["http://localhost:3000", "http://127.0.0.1/x", "http://10.0.0.5/", "http://192.168.1.1/", "http://169.254.169.254/latest", "http://172.16.0.1/", "file:///etc/passwd", "ftp://example.com", "not a url", "http://intranet/"]) {
    assert.equal(isPublicHttpUrl(bad), false, bad);
  }
});

test("fetchPageFingerprint returns a fingerprint, and null on failure or a blocked URL", async () => {
  const ok = (async () => new Response(PAGE, { status: 200 })) as unknown as typeof fetch;
  assert.equal((await fetchPageFingerprint("https://example.com", ok))?.title, "Old Title");
  const notFound = (async () => new Response("x", { status: 404 })) as unknown as typeof fetch;
  assert.equal(await fetchPageFingerprint("https://example.com", notFound), null);
  const boom = (async () => { throw new Error("network"); }) as unknown as typeof fetch;
  assert.equal(await fetchPageFingerprint("https://example.com", boom), null);
  let called = false;
  const spy = (async () => { called = true; return new Response(PAGE); }) as unknown as typeof fetch;
  assert.equal(await fetchPageFingerprint("http://127.0.0.1/admin", spy), null);
  assert.equal(called, false, "never even requests a private address");
});
