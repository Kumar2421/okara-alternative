import test from "node:test";
import assert from "node:assert/strict";
import { ContentsApiFixProvider } from "../lib/domain/codefix/ContentsApiFixProvider.ts";
import { buildPrBody, sanitizeProse, type FixChange } from "../lib/domain/codefix/catalogFix.ts";
import { MAX_SOURCE_FILE_BYTES } from "../lib/domain/codefix/fixCatalog.ts";
import { deriveTicketSecret, hashChanges, issueTicket, redeemTicket, reviseTicket, type TicketClaimPort } from "../lib/domain/codefix/ticket.ts";
import type { CodeFixContext } from "../lib/domain/codefix/types.ts";

const secret = "k".repeat(64);
const subject = { userId: "u1", projectId: "p1", findingId: "f1" };
const changes: FixChange[] = [
  { type: "edit", path: "app/page.tsx", oldSnippet: "</head>", newSnippet: "<meta/></head>" },
  { type: "create", path: "public/llms.txt", content: "# Acme\n" },
];
const fix = { changes, kinds: ["json_ld", "llms_txt"] as never, label: "Fix" };

function memoryClaims() {
  const used = new Set<string>();
  const port: TicketClaimPort = {
    async claim(n) { if (used.has(n)) return false; used.add(n); return true; },
    async release(n) { used.delete(n); },
  };
  return { used, port };
}

test("ticket secret comes from a stable env signing secret and is null when none is set", () => {
  assert.equal(deriveTicketSecret({}), null);
  assert.equal(deriveTicketSecret({ GITHUB_APP_CLIENT_SECRET: "  " }), null);
  const a = deriveTicketSecret({ GITHUB_APP_CLIENT_SECRET: "abc" });
  assert.equal(a, deriveTicketSecret({ GITHUB_APP_CLIENT_SECRET: "abc" }), "stable across instances");
  assert.notEqual(a, deriveTicketSecret({ GITHUB_APP_CLIENT_SECRET: "abd" }));
  assert.equal(deriveTicketSecret({ NOTIFY_SIGNING_SECRET: "n" }), deriveTicketSecret({ NOTIFY_SIGNING_SECRET: "n" }));
  assert.ok(a && !a.includes("abc"));
});

test("hashChanges ignores order but not content", () => {
  assert.equal(hashChanges(changes), hashChanges([...changes].reverse()));
  assert.notEqual(hashChanges(changes), hashChanges([{ ...changes[0], newSnippet: "x" } as FixChange, changes[1]]));
});

test("the exact previewed changes redeem once; a replay is rejected", async () => {
  const { port } = memoryClaims();
  const ticket = issueTicket(secret, subject, fix);
  const first = await redeemTicket(secret, ticket, subject, changes, port);
  assert.equal(first.ok, true);
  const replay = await redeemTicket(secret, ticket, subject, changes, port);
  assert.equal(replay.ok, false);
  assert.match(replay.ok ? "" : replay.error, /already used/);
});

test("a failed write releases the ticket so the same preview can be retried", async () => {
  const { port } = memoryClaims();
  const ticket = issueTicket(secret, subject, fix);
  const first = await redeemTicket(secret, ticket, subject, changes, port);
  assert.ok(first.ok);
  if (first.ok) await first.release();
  assert.equal((await redeemTicket(secret, ticket, subject, changes, port)).ok, true);
});

test("content that differs from the preview is rejected and does not burn the ticket", async () => {
  const { port } = memoryClaims();
  const ticket = issueTicket(secret, subject, fix);
  const tampered = [{ ...changes[0], newSnippet: "<script>evil()</script></head>" }, changes[1]];
  const res = await redeemTicket(secret, ticket, subject, tampered, port);
  assert.equal(res.ok, false);
  assert.equal(res.ok ? 0 : res.status, 409);
  assert.equal((await redeemTicket(secret, ticket, subject, changes, port)).ok, true);
});

test("ticket is bound to user, project and finding, and to its signing key", async () => {
  const { port } = memoryClaims();
  const ticket = issueTicket(secret, subject, fix);
  for (const other of [{ ...subject, userId: "u2" }, { ...subject, projectId: "p2" }, { ...subject, findingId: "f2" }]) {
    assert.equal((await redeemTicket(secret, ticket, other, changes, port)).ok, false);
  }
  assert.equal((await redeemTicket("z".repeat(64), ticket, subject, changes, port)).ok, false);
  assert.equal((await redeemTicket(secret, ticket, subject, changes, port, Date.now() + 31 * 60 * 1000)).ok, false, "expired");
});

test("an explicit edit goes through revise: new ticket for the edit, old one consumed, paths still limited", async () => {
  const { port } = memoryClaims();
  const ticket = issueTicket(secret, subject, fix);
  const edited: FixChange[] = [{ ...changes[0], newSnippet: "<meta name='x'/></head>" } as FixChange, changes[1]];
  const revised = await reviseTicket(secret, ticket, subject, edited, port);
  assert.ok(revised.ok);
  const newTicket = revised.ok ? revised.ticket : "";
  assert.equal((await redeemTicket(secret, ticket, subject, edited, port)).ok, false, "old ticket is consumed");
  assert.equal((await redeemTicket(secret, newTicket, subject, changes, port)).ok, false, "new ticket only covers the edit");
  assert.equal((await redeemTicket(secret, newTicket, subject, edited, port)).ok, true);

  const t2 = issueTicket(secret, subject, fix);
  const outside = [{ type: "create", path: "package.json", content: "x" }];
  assert.equal((await reviseTicket(secret, t2, subject, outside, port)).ok, false);
  const dotfile = [{ type: "create", path: ".github/workflows/x.yml", content: "x" }];
  assert.equal((await reviseTicket(secret, t2, subject, dotfile, port)).ok, false);
});

test("PR text from the client is inert: no HTML, mentions, links or issue refs", () => {
  const nasty = "Hi @octocat <img src=x onerror=1> [click](http://evil) #123 `x`\n\n## Heading";
  const clean = sanitizeProse(nasty);
  assert.ok(!/[<>@`[\]\n]/.test(clean) && !clean.replace(/&#\d+;/g, "").includes("#"), clean);
  const body = buildPrBody({ findingId: "f1", label: "L", recommendation: "R", pageUrl: null, explanation: nasty, kinds: ["json_ld"] }, changes);
  assert.ok(!body.includes("<img"));
  assert.ok(!body.includes("@octocat"));
  assert.ok(!body.includes("## Heading"));
});

// ---- provider guards (fake fetch) ----

const ctx: CodeFixContext = { projectId: "p1", projectName: "Acme", projectUrl: "https://acme.com", repoFullName: "acme/site", githubToken: "ghs_fake" };

function withFetch(handler: (url: URL, init?: RequestInit) => Response, run: (calls: string[]) => Promise<void>) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    return handler(url, init);
  }) as typeof fetch;
  return run(calls).finally(() => { globalThis.fetch = original; });
}
const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

test("a located file outside the safe-path rules is rejected before reading it or calling the LLM", async () => {
  let llmCalled = false;
  const provider = new ContentsApiFixProvider((async () => { llmCalled = true; return { text: "" }; }) as never, "k", "m");
  await withFetch(
    (url) => {
      if (url.pathname === "/repos/acme/site") return j({ default_branch: "main", full_name: "acme/site" });
      if (url.pathname === "/search/code") return j({ items: [{ path: ".github/workflows/about.yml" }, { path: "node_modules/x/about.js" }] });
      return j({}, 404);
    },
    async (calls) => {
      await assert.rejects(
        provider.proposeCatalogFix({ findingId: "f", label: "L", kinds: ["json_ld"], recommendation: "r", evidence: {}, pageUrl: "https://acme.com/about" }, ctx),
        /may edit|won't edit/,
      );
      assert.ok(!calls.some((c) => c.includes("/contents/")), "no file read");
    },
  );
  assert.equal(llmCalled, false);
});

test("apply enforces the source file size limit on the current file", async () => {
  const provider = new ContentsApiFixProvider((async () => ({ text: "" })) as never, "k", "m");
  const big = "a".repeat(MAX_SOURCE_FILE_BYTES + 10) + "</head>";
  await withFetch(
    (url) => {
      if (url.pathname === "/repos/acme/site") return j({ default_branch: "main", full_name: "acme/site" });
      if (url.pathname === "/repos/acme/site/contents/app/page.tsx") return j({ encoding: "base64", content: Buffer.from(big).toString("base64"), sha: "s" });
      return j({}, 404);
    },
    async (calls) => {
      await assert.rejects(
        provider.applyCatalogFix([changes[0]], ctx, { findingId: "f", label: "L", recommendation: "r", pageUrl: null, explanation: "e", kinds: ["json_ld"] }),
        /too large/,
      );
      assert.ok(!calls.some((c) => c.startsWith("POST") || c.startsWith("PUT")), "nothing written");
    },
  );
});

test("legacy applyFix refuses unsafe paths and oversized content, and GitHub bodies are not echoed", async () => {
  const provider = new ContentsApiFixProvider((async () => ({ text: "" })) as never, "k", "m");
  const finding = { issueId: "i", label: "L", category: "c" } as never;
  const base = { before: "", oldSnippet: "", newSnippet: "", explanation: "e", applyToken: "s" };
  await assert.rejects(provider.applyFix({ ...base, filePath: ".github/workflows/ci.yml", after: "x" }, ctx, finding), /can't be changed/);
  await assert.rejects(provider.applyFix({ ...base, filePath: "../etc/passwd", after: "x" }, ctx, finding), /can't be changed/);
  await assert.rejects(provider.applyFix({ ...base, filePath: "app/page.tsx", after: "a".repeat(MAX_SOURCE_FILE_BYTES + 1) }, ctx, finding), /too large/);

  await withFetch(
    (url) => {
      if (url.pathname === "/repos/acme/site") return j({ default_branch: "main", full_name: "acme/site" });
      if (url.pathname.endsWith("/git/ref/heads/main")) return j({ object: { sha: "b" } });
      if (url.pathname.endsWith("/git/refs")) return new Response("SECRET-INTERNAL-DETAIL", { status: 403 });
      return j({}, 404);
    },
    async () => {
      await assert.rejects(provider.applyFix({ ...base, filePath: "app/page.tsx", after: "x" }, ctx, finding), (err: Error) => !err.message.includes("SECRET-INTERNAL-DETAIL") && /403/.test(err.message));
    },
  );
});
