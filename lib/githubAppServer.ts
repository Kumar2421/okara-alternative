import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { readGithubAppConfig, stateSecret, type GithubAppConfig } from "@/lib/domain/github/githubApp";
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
  return { userId: user.id, db, projectId: setting.value, cfg, deps: { cfg, store: githubAppStoreSupabase(db, user.id) } };
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

let fallbackSecret: string | null = null;

/** Key for proposal tickets: derived from the app key when configured, else a per-process secret (self-host). */
export function ticketSecret(): string {
  const cfg = readGithubAppConfig();
  if (cfg) return `ticket:${stateSecret(cfg)}`;
  fallbackSecret ??= crypto.randomBytes(32).toString("hex");
  return fallbackSecret;
}
