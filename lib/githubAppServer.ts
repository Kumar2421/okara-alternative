import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { getDb } from "@/lib/db";
import { deriveTicketSecret, type TicketClaimPort } from "@/lib/domain/codefix/ticket";
import { readGithubAppConfig, type GithubAppConfig } from "@/lib/domain/github/githubApp";
import { resolveGithubAccess, type GithubAppDeps } from "@/lib/domain/github/githubAppService";
import { githubAppStoreSupabase } from "@/lib/domain/github/githubAppStoreSupabase";

/** Server-only glue for the hosted GitHub App routes. Nothing here persists a token. */

export type HostedContext = {
  userId: string;
  db: ReturnType<typeof createServiceClient>;
  projectId: string;
  cfg: GithubAppConfig;
  deps: GithubAppDeps;
};

export const SETTINGS_PATH = "/settings/integrations";

/** Signed-in user + active project + app config, or the JSON error response to return. */
export async function hostedContext(): Promise<HostedContext | NextResponse> {
  if (!FEATURES.PLATFORM_MODE) return NextResponse.json({ error: "The GitHub App is available on hosted deployments only." }, { status: 404 });
  const cfg = readGithubAppConfig();
  if (!cfg) return NextResponse.json({ error: "The GitHub App isn't configured on this deployment." }, { status: 503 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const db = createServiceClient();
  const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
  if (!setting?.value) return NextResponse.json({ error: "Select or create a project first." }, { status: 422 });
  // The stored active project id is only a pointer: it must be a project this user owns.
  const { data: project } = await db.from("projects").select("id").eq("id", setting.value).eq("owner_id", user.id).maybeSingle();
  if (!project) return NextResponse.json({ error: "Select or create a project first." }, { status: 422 });
  return { userId: user.id, db, projectId: project.id, cfg, deps: { cfg, store: githubAppStoreSupabase(db, user.id) } };
}

export function isHostedContext(value: HostedContext | NextResponse): value is HostedContext {
  return !(value instanceof NextResponse);
}

/**
 * A short-lived token for reading PR state in hosted mode: the GitHub App installation token when
 * connected, else the legacy OAuth/PAT token. Never stored.
 */
export async function hostedGithubToken(db: ReturnType<typeof createServiceClient>, userId: string, projectId: string): Promise<string | null> {
  const cfg = readGithubAppConfig();
  if (cfg) {
    try {
      const access = await resolveGithubAccess({ cfg, store: githubAppStoreSupabase(db, userId) }, projectId);
      if (access.status === "ready") return access.token;
    } catch {
      // fall through to the legacy token
    }
  }
  const { data: conn } = await db.from("provider_connections").select("api_key_secret_id").eq("user_id", userId).eq("provider_id", "github").maybeSingle();
  if (!conn?.api_key_secret_id) return null;
  const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
  return (secret as string) || null;
}

const SELF_HOST_SECRET_KEY = "codefix_ticket_secret";
const USED_PREFIX = "codefix_ticket_used:";

/**
 * Key for proposal tickets. Hosted: derived from a stable signing secret in the environment
 * (GITHUB_APP_CLIENT_SECRET, else NOTIFY_SIGNING_SECRET), so every serverless instance agrees; with
 * none set it fails closed. Self-host: the same env if present, else a generated secret kept in the
 * settings table.
 */
export function ticketSecret(): string {
  const fromEnv = deriveTicketSecret(process.env);
  if (fromEnv) return fromEnv;
  if (FEATURES.PLATFORM_MODE) {
    throw new Error("Fix approvals aren't configured on this deployment. Set GITHUB_APP_CLIENT_SECRET or NOTIFY_SIGNING_SECRET.");
  }
  const db = getDb();
  const read = () => (db.prepare("SELECT value FROM settings WHERE key = ?").get(SELF_HOST_SECRET_KEY) as { value: string } | undefined)?.value;
  const existing = read();
  if (existing) return existing;
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(SELF_HOST_SECRET_KEY, crypto.randomBytes(32).toString("hex"));
  return read()!;
}

/** Consumed-ticket memory in existing storage: user_settings (hosted) or settings (self-host). */
export function ticketClaimsFor(userId: string | null): TicketClaimPort {
  if (userId === null) {
    const db = getDb();
    return {
      async claim(nonce, expiresAt) {
        const now = Date.now();
        for (const row of db.prepare("SELECT key, value FROM settings WHERE key LIKE ?").all(USED_PREFIX + "%") as { key: string; value: string }[]) {
          if (Number(row.value) < now) db.prepare("DELETE FROM settings WHERE key = ?").run(row.key);
        }
        return db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(USED_PREFIX + nonce, String(expiresAt)).changes === 1;
      },
      async release(nonce) {
        db.prepare("DELETE FROM settings WHERE key = ?").run(USED_PREFIX + nonce);
      },
    };
  }
  const db = createServiceClient();
  return {
    async claim(nonce, expiresAt) {
      const { data: rows } = await db.from("user_settings").select("key, value").eq("user_id", userId).like("key", USED_PREFIX + "%");
      const now = Date.now();
      for (const row of (rows ?? []) as { key: string; value: string }[]) {
        if (Number(row.value) < now) await db.from("user_settings").delete().eq("user_id", userId).eq("key", row.key);
      }
      // A plain insert hits the (user_id, key) unique constraint on replay, which makes this atomic.
      const { error } = await db.from("user_settings").insert({ user_id: userId, key: USED_PREFIX + nonce, value: String(expiresAt), updated_at: new Date().toISOString() });
      if (!error) return true;
      if (error.code === "23505") return false;
      throw new Error("Couldn't record the approval. Try again.");
    },
    async release(nonce) {
      await db.from("user_settings").delete().eq("user_id", userId).eq("key", USED_PREFIX + nonce);
    },
  };
}
