import type { SupabaseClient } from "@supabase/supabase-js";
import type { GithubAppLink, GithubAppStorePort } from "./githubAppService.ts";

const PREFIX = "github_app:";

function parse(value: string | null | undefined): GithubAppLink | null {
  if (!value) return null;
  try {
    const v = JSON.parse(value) as Partial<GithubAppLink>;
    if (typeof v.installationId !== "number") return null;
    return { installationId: v.installationId, repoFullName: typeof v.repoFullName === "string" ? v.repoFullName : null, connectedAt: typeof v.connectedAt === "string" ? v.connectedAt : "" };
  } catch {
    return null;
  }
}

/**
 * Stores the per-project GitHub App link in the existing `user_settings` key/value table
 * (key `github_app:<projectId>`), so no schema change is needed. Only the installation id and the
 * chosen repo name are kept; tokens are minted on demand and never saved.
 */
export function githubAppStoreSupabase(db: SupabaseClient, userId: string): GithubAppStorePort {
  return {
    async get(projectId) {
      const { data } = await db.from("user_settings").select("value").eq("user_id", userId).eq("key", PREFIX + projectId).maybeSingle();
      return parse(data?.value);
    },
    async set(projectId, link) {
      const { error } = await db
        .from("user_settings")
        .upsert({ user_id: userId, key: PREFIX + projectId, value: JSON.stringify(link), updated_at: new Date().toISOString() }, { onConflict: "user_id,key" });
      if (error) throw new Error(error.message);
    },
    async clear(projectId) {
      const { error } = await db.from("user_settings").delete().eq("user_id", userId).eq("key", PREFIX + projectId);
      if (error) throw new Error(error.message);
    },
    async usedByOtherProject(projectId, installationId) {
      const { data } = await db.from("user_settings").select("key, value").eq("user_id", userId).like("key", `${PREFIX}%`);
      return (data ?? []).some((row: { key: string; value: string | null }) => row.key !== PREFIX + projectId && parse(row.value)?.installationId === installationId);
    },
  };
}
