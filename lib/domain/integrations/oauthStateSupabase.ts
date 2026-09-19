import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Supabase mirror of oauthState.ts (self-host, SQLite `oauth_states` table)
 * — same shape, backed by integration_oauth_states instead. Server-role
 * only (no RLS policy grants a client role access to this table at all). */

export type OAuthState = {
  projectId: string;
  returnTo: "dashboard" | "settings";
};

export async function createOAuthState(db: SupabaseClient, userId: string, input: OAuthState): Promise<string> {
  const state = crypto.randomBytes(32).toString("hex");
  const { error } = await db.from("integration_oauth_states").insert({
    state,
    user_id: userId,
    project_id: input.projectId,
    return_to: input.returnTo,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);
  return state;
}

export async function consumeOAuthState(db: SupabaseClient, state: string): Promise<(OAuthState & { userId: string }) | null> {
  const { data } = await db
    .from("integration_oauth_states")
    .select("user_id, project_id, return_to, expires_at")
    .eq("state", state)
    .maybeSingle();

  await db.from("integration_oauth_states").delete().eq("state", state);

  if (!data || new Date(data.expires_at).getTime() < Date.now()) return null;
  return { userId: data.user_id, projectId: data.project_id, returnTo: data.return_to };
}
