import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  InstallationGoneError,
  createAppJwt,
  createInstallState,
  installUrl,
  listInstallationRepos,
  mintInstallationToken,
  normalizePrivateKey,
  readGithubAppConfig,
  safeReturnPath,
  verifyInstallState,
  type FetchLike,
  type GithubAppConfig,
} from "../lib/domain/github/githubApp.ts";
import { signPayload, verifyPayload } from "../lib/domain/github/signedPayload.ts";
import {
  completeInstall,
  listSelectableRepos,
  disconnectGithubApp,
  resolveGithubAccess,
  selectRepository,
  startInstall,
  type GithubAppLink,
  type GithubAppStorePort,
} from "../lib/domain/github/githubAppService.ts";

// Throwaway keypair generated in memory for this test only.
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
const cfg: GithubAppConfig = { appId: "123", clientId: "Iv.test", clientSecret: "shh", slug: "my-app", privateKey: privatePem };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function memoryStore(initial: Record<string, GithubAppLink> = {}) {
  const data = new Map(Object.entries(initial));
  const port: GithubAppStorePort = {
    async get(id) { return data.get(id) ?? null; },
    async set(id, link) { data.set(id, link); },
    async clear(id) { data.delete(id); },
  };
  return { data, port };
}

test("JWT is RS256, verifies with the public key and is short-lived", () => {
  const now = Date.UTC(2026, 9, 7);
  const jwt = createAppJwt(cfg, now);
  const [h, p, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.equal(payload.iss, "123");
  assert.ok(payload.exp - payload.iat <= 10 * 60);
  assert.ok(payload.iat <= Math.floor(now / 1000));
  assert.equal(crypto.createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url")), true);
});

test("private key accepts literal \\n escapes and quotes", () => {
  const escaped = `"${privatePem.trim().replace(/\n/g, "\\n")}"`;
  assert.equal(normalizePrivateKey(escaped), privatePem.trim());
  const c = readGithubAppConfig({ GITHUB_APP_ID: "1", GITHUB_APP_SLUG: "s", GITHUB_APP_PRIVATE_KEY: escaped });
  assert.ok(c);
  assert.doesNotThrow(() => createAppJwt(c!));
  assert.equal(readGithubAppConfig({ GITHUB_APP_ID: "1" }), null);
});

test("installUrl embeds the slug and an encoded state", () => {
  assert.equal(installUrl("mlforge-studio", "a b"), "https://github.com/apps/mlforge-studio/installations/new?state=a%20b");
});

test("install state: round trip, tamper, expiry, wrong key all fail closed", () => {
  const now = 1_000_000;
  const state = createInstallState(cfg, { userId: "u1", projectId: "p1", returnTo: "/dashboard?finding=f1" }, now);
  assert.deepEqual(verifyInstallState(cfg, state, now + 1000), { userId: "u1", projectId: "p1", returnTo: "/dashboard?finding=f1" });
  assert.equal(verifyInstallState(cfg, state, now + 16 * 60 * 1000), null);
  const [body, sig] = state.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), userId: "attacker" })).toString("base64url");
  assert.equal(verifyInstallState(cfg, `${forged}.${sig}`, now), null);
  assert.equal(verifyInstallState(cfg, `${body}.AAAA`, now), null);
  assert.equal(verifyInstallState(cfg, "garbage", now), null);
  assert.equal(verifyInstallState(cfg, undefined, now), null);
  const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  assert.equal(verifyInstallState({ privateKey: other }, state, now), null);
  // A token minted for another purpose is rejected.
  const wrongPurpose = signPayload("k", "other", { userId: "u1", projectId: "p1" }, 1000, now);
  assert.equal(verifyPayload("k", "github-app-install", wrongPurpose, now), null);
});

test("safeReturnPath only allows same-site paths", () => {
  assert.equal(safeReturnPath("/dashboard?finding=1"), "/dashboard?finding=1");
  for (const bad of ["https://evil.com", "//evil.com", "dashboard", "/a\\b", "/a\r\nb", 5]) assert.equal(safeReturnPath(bad), null);
  const state = createInstallState(cfg, { userId: "u", projectId: "p", returnTo: "//evil.com" });
  assert.equal(verifyInstallState(cfg, state)?.returnTo, null);
});

test("mints a short-lived installation token narrowed to the repo; 404 means gone", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return json({ token: "ghs_fake", expires_at: "2026-10-07T01:00:00Z" }, 201);
  };
  const t = await mintInstallationToken(cfg, 77, { fetch: f, repo: "acme/site" });
  assert.equal(t.token, "ghs_fake");
  assert.equal(calls[0].url, "https://api.github.com/app/installations/77/access_tokens");
  assert.match(String((calls[0].init?.headers as Record<string, string>).Authorization), /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)).repositories, ["site"]);
  await assert.rejects(mintInstallationToken(cfg, 77, { fetch: async () => json({}, 404) }), InstallationGoneError);
  await assert.rejects(mintInstallationToken(cfg, 77, { fetch: async () => json({}, 500) }), /HTTP 500/);
});

test("errors never contain secrets", async () => {
  await assert.rejects(
    mintInstallationToken(cfg, 1, { fetch: async () => json({ message: "bad" }, 401) }),
    (e: Error) => !e.message.includes(privatePem) && !e.message.includes("shh"),
  );
});

test("lists installation repositories", async () => {
  const f: FetchLike = async () => json({ repositories: [{ full_name: "acme/site", default_branch: "main", private: true }] });
  assert.deepEqual(await listInstallationRepos("tok", f), [{ fullName: "acme/site", defaultBranch: "main", private: true }]);
});

// ---- install flow ----

function githubFake(opts: { userInstallations?: number[]; repos?: string[]; userRepos?: string[]; goneInstallation?: boolean } = {}) {
  const calls: string[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "https://github.com/login/oauth/access_token") return json({ access_token: "ghu_user" });
    if (/\/user\/installations\/\d+\/repositories/.test(url)) return json({ repositories: (opts.userRepos ?? ["acme/site", "acme/blog"]).map((full_name) => ({ full_name })) });
    if (url.startsWith("https://api.github.com/user/installations")) return json({ installations: (opts.userInstallations ?? [42]).map((id) => ({ id })) });
    if (url.includes("/access_tokens")) return opts.goneInstallation ? json({}, 404) : json({ token: "ghs_inst", expires_at: "x" }, 201);
    if (url.startsWith("https://api.github.com/installation/repositories")) {
      return json({ repositories: (opts.repos ?? ["acme/site", "acme/blog"]).map((full_name) => ({ full_name, default_branch: "main", private: false })) });
    }
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return json({}, 404);
  };
  return { f, calls };
}

test("completeInstall saves only installation id when state, user and ownership check out", async () => {
  const { port, data } = memoryStore();
  const { f } = githubFake({ userInstallations: [42] });
  const started = startInstall(cfg, { userId: "u1", projectId: "p1", returnTo: "/dashboard?finding=f9" });
  assert.ok(started.ok);
  const state = new URL(started.ok ? started.url : "").searchParams.get("state");
  const res = await completeInstall({ cfg, store: port, fetch: f }, { userId: "u1", state, installationId: "42", code: "c" });
  assert.deepEqual(res, { ok: true, projectId: "p1", returnTo: "/dashboard?finding=f9" });
  const saved = data.get("p1")!;
  assert.equal(saved.installationId, 42);
  assert.equal(saved.repoFullName, null);
  assert.deepEqual(saved.allowedRepos, ["acme/site", "acme/blog"]);
  assert.deepEqual(Object.keys(saved).sort(), ["allowedRepos", "connectedAt", "installationId", "repoFullName"]);
});

test("completeInstall fails closed: bad state, other user, forged installation, no code", async () => {
  const state = (u = "u1") => new URL((startInstall(cfg, { userId: u, projectId: "p1" }) as { url: string }).url).searchParams.get("state");
  const run = async (input: Parameters<typeof completeInstall>[1], fake = githubFake()) => {
    const { port, data } = memoryStore();
    const res = await completeInstall({ cfg, store: port, fetch: fake.f }, input);
    return { res, saved: data.size };
  };
  assert.equal((await run({ userId: "u1", state: "nope", installationId: "42", code: "c" })).res.ok, false);
  assert.equal((await run({ userId: "u2", state: state("u1"), installationId: "42", code: "c" })).res.ok, false);
  assert.equal((await run({ userId: "u1", state: state(), installationId: "999", code: "c" })).res.ok, false);
  assert.equal((await run({ userId: "u1", state: state(), installationId: "42", code: null })).res.ok, false);
  assert.equal((await run({ userId: "u1", state: state(), installationId: "abc", code: "c" })).res.ok, false);
  const all = await run({ userId: "u1", state: state(), installationId: "999", code: "c" });
  assert.equal(all.saved, 0);
});

test("repo selection: only repos the installation shares, one per project", async () => {
  const { port, data } = memoryStore({ p1: { installationId: 42, allowedRepos: ["acme/site", "acme/blog"], repoFullName: null, connectedAt: "t" } });
  const { f } = githubFake({ repos: ["acme/site", "acme/blog"] });
  const deps = { cfg, store: port, fetch: f };
  assert.deepEqual(await selectRepository(deps, "p1", "acme/site"), { ok: true, repoFullName: "acme/site" });
  assert.equal(data.get("p1")!.repoFullName, "acme/site");
  const bad = await selectRepository(deps, "p1", "evil/steal");
  assert.equal(bad.ok, false);
  assert.equal(data.get("p1")!.repoFullName, "acme/site");
  assert.equal((await selectRepository(deps, "p1", "../x")).ok, false);
  assert.equal((await selectRepository(deps, "other", "acme/site")).ok, false);
});

test("resolveGithubAccess mints a token for the chosen repo; uninstalled app is cleared gracefully", async () => {
  const ready = memoryStore({ p1: { installationId: 42, allowedRepos: ["acme/site", "acme/blog"], repoFullName: "acme/site", connectedAt: "t" } });
  const access = await resolveGithubAccess({ cfg, store: ready.port, fetch: githubFake().f }, "p1");
  assert.deepEqual(access, { status: "ready", installationId: 42, repoFullName: "acme/site", token: "ghs_inst" });
  assert.ok(!JSON.stringify([...ready.data.values()]).includes("ghs_inst"), "token must never be persisted");

  const gone = memoryStore({ p1: { installationId: 42, allowedRepos: ["acme/site", "acme/blog"], repoFullName: "acme/site", connectedAt: "t" } });
  assert.deepEqual(await resolveGithubAccess({ cfg, store: gone.port, fetch: githubFake({ goneInstallation: true }).f }, "p1"), { status: "disconnected" });
  assert.equal(gone.data.size, 0);

  const none = memoryStore({ p1: { installationId: 42, allowedRepos: ["acme/site", "acme/blog"], repoFullName: null, connectedAt: "t" } });
  assert.equal((await resolveGithubAccess({ cfg, store: none.port, fetch: githubFake().f }, "p1")).status, "no_repo");
  assert.deepEqual(await resolveGithubAccess({ cfg, store: none.port, fetch: githubFake().f }, "missing"), { status: "disconnected" });
});

test("disconnect clears only Marlo's link and never uninstalls the app", async () => {
  const solo = memoryStore({ p1: { installationId: 42, allowedRepos: ["acme/site"], repoFullName: "acme/site", connectedAt: "t" } });
  const fake = githubFake();
  await disconnectGithubApp({ cfg, store: solo.port, fetch: fake.f }, "p1");
  assert.equal(solo.data.size, 0);
  assert.deepEqual(fake.calls, [], "no GitHub call at all, in particular no DELETE of the installation");
});

test("callback stores only the repos the connecting user can access (not the whole installation)", async () => {
  const { port, data } = memoryStore();
  const { f, calls } = githubFake({ userInstallations: [42], repos: ["acme/site", "acme/secret"], userRepos: ["acme/site"] });
  const state = new URL((startInstall(cfg, { userId: "u1", projectId: "p1" }) as { url: string }).url).searchParams.get("state");
  const res = await completeInstall({ cfg, store: port, fetch: f }, { userId: "u1", state, installationId: "42", code: "c" });
  assert.equal(res.ok, true);
  assert.deepEqual(data.get("p1")!.allowedRepos, ["acme/site"]);
  assert.ok(calls.some((c) => c.includes("/user/installations/42/repositories")));
  assert.ok(!JSON.stringify([...data.values()]).includes("ghu_user"), "user token must not be stored");
});

test("a repo the installation shares but the user cannot read is rejected and not listed", async () => {
  const { port, data } = memoryStore({ p1: { installationId: 42, allowedRepos: ["acme/site"], repoFullName: null, connectedAt: "t" } });
  const { f } = githubFake({ repos: ["acme/site", "acme/secret"] });
  const deps = { cfg, store: port, fetch: f };
  const bad = await selectRepository(deps, "p1", "acme/secret");
  assert.equal(bad.ok, false);
  assert.equal(data.get("p1")!.repoFullName, null);
  const listed = await listSelectableRepos(deps, "p1");
  assert.deepEqual(listed.ok ? listed.repos.map((r) => r.fullName) : null, ["acme/site"]);
  assert.equal((await selectRepository(deps, "p1", "ACME/Site")).ok, true);
});

test("a stored repo outside the allowlist (legacy link) gets no token", async () => {
  const legacy = memoryStore({ p1: { installationId: 42, allowedRepos: [], repoFullName: "acme/secret", connectedAt: "t" } });
  const fake = githubFake();
  assert.equal((await resolveGithubAccess({ cfg, store: legacy.port, fetch: fake.f }, "p1")).status, "no_repo");
  assert.ok(!fake.calls.some((c) => c.includes("/access_tokens")));
});
