import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeRedditSettings, type RedditSettings } from "./redditSettings.ts";
import { REDDIT_SETTINGS_DOC } from "./redditSettingsStore.ts";

// Platform (Supabase) store; every query is scoped by user and project explicitly.

export async function getRedditSettings(db: SupabaseClient, userId: string, projectId: string): Promise<RedditSettings> {
  const { data } = await db
    .from("project_documents")
    .select("content")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("doc_type", REDDIT_SETTINGS_DOC)
    .maybeSingle();
  if (!data?.content) return normalizeRedditSettings(null);
  try {
    return normalizeRedditSettings(JSON.parse(data.content as string));
  } catch {
    return normalizeRedditSettings(null);
  }
}

export async function saveRedditSettings(db: SupabaseClient, userId: string, projectId: string, settings: RedditSettings, now = new Date()): Promise<void> {
  const stamp = now.toISOString();
  const { data: existing } = await db
    .from("project_documents")
    .select("created_at")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("doc_type", REDDIT_SETTINGS_DOC)
    .maybeSingle();
  const { error } = await db.from("project_documents").upsert(
    {
      user_id: userId,
      project_id: projectId,
      doc_type: REDDIT_SETTINGS_DOC,
      status: "ready",
      content: JSON.stringify(settings),
      created_at: existing?.created_at ?? stamp,
      updated_at: stamp,
    },
    { onConflict: "project_id,doc_type" },
  );
  if (error) throw new Error(error.message);
}
