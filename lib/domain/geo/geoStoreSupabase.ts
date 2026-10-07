import type { SupabaseClient } from "@supabase/supabase-js";
import type { RunStore } from "./runner.ts";
import type { AnswerMethod, GeoPrompt, GeoRunRow } from "./types.ts";

// Platform (Supabase) store. Uses the service-role client, so every query is
// scoped by user_id and project_id explicitly.

const dayStart = (date: string) => `${date}T00:00:00.000Z`;
const dayEnd = (date: string) => `${date}T23:59:59.999Z`;

export async function listPrompts(db: SupabaseClient, userId: string, projectId: string): Promise<GeoPrompt[]> {
  const { data } = await db
    .from("geo_prompts")
    .select("prompt, source, active")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  return (data ?? []).map((r) => ({ prompt: String(r.prompt), source: r.source === "manual" ? "manual" : "gsc", active: Boolean(r.active) }));
}

export async function replacePrompts(db: SupabaseClient, userId: string, projectId: string, prompts: GeoPrompt[]): Promise<void> {
  const del = await db.from("geo_prompts").delete().eq("project_id", projectId).eq("user_id", userId);
  if (del.error) throw new Error(del.error.message);
  if (prompts.length === 0) return;
  const { error } = await db.from("geo_prompts").insert(
    prompts.map((p) => ({ project_id: projectId, user_id: userId, prompt: p.prompt, source: p.source, active: p.active })),
  );
  if (error) throw new Error(error.message);
}

export async function listRuns(db: SupabaseClient, userId: string, projectId: string, sinceIso: string): Promise<GeoRunRow[]> {
  const { data } = await db
    .from("geo_runs")
    .select("prompt, engine, method, run_at, mentioned, cited, competitors, sources, answer_excerpt")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .gte("run_at", sinceIso)
    .order("run_at", { ascending: false })
    .limit(2000);
  return (data ?? []).map((r) => ({
    prompt: String(r.prompt),
    engine: String(r.engine),
    method: r.method as AnswerMethod,
    runAt: new Date(String(r.run_at)).toISOString(),
    mentioned: Boolean(r.mentioned),
    cited: Boolean(r.cited),
    competitors: (r.competitors as string[]) ?? [],
    sources: (r.sources as string[]) ?? [],
    answerExcerpt: String(r.answer_excerpt ?? ""),
  }));
}

/** The daily cap is per user (across all their projects), so method counts are not project-scoped. */
export function supabaseRunStore(db: SupabaseClient, userId: string, projectId: string): RunStore {
  return {
    async countRuns(prompt, method, date) {
      const { count } = await db
        .from("geo_runs")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId).eq("user_id", userId).eq("prompt", prompt).eq("method", method)
        .gte("run_at", dayStart(date)).lte("run_at", dayEnd(date));
      return count ?? 0;
    },
    async countMethodRunsToday(method, date) {
      const { data } = await db.from("geo_usage").select("used").eq("user_id", userId).eq("method", method).eq("day", date).maybeSingle();
      return Number(data?.used ?? 0);
    },
    async reserve(method, date, cap) {
      const { data, error } = await db.rpc("geo_reserve_slots", { p_user: userId, p_method: method, p_day: date, p_n: 1, p_cap: cap });
      if (error) throw new Error(error.message);
      return data === true;
    },
    async tryLock(ttlMs) {
      const { data, error } = await db.rpc("geo_try_lock", { p_user: userId, p_project: projectId, p_ttl_seconds: Math.ceil(ttlMs / 1000) });
      if (error) throw new Error(error.message);
      return data === true;
    },
    async unlock() {
      await db.from("geo_locks").delete().eq("project_id", projectId).eq("user_id", userId);
    },
    async saveRuns(rows) {
      const { error } = await db.from("geo_runs").insert(
        rows.map((r) => ({
          project_id: projectId, user_id: userId, prompt: r.prompt, engine: r.engine, method: r.method, run_at: r.runAt,
          mentioned: r.mentioned, cited: r.cited, competitors: r.competitors, sources: r.sources, answer_excerpt: r.answerExcerpt,
        })),
      );
      if (error) throw new Error(error.message);
    },
  };
}

/** Most recent run per project (any method), for ordering the weekly cron. Projects never run are absent. */
export async function lastRunByProject(db: SupabaseClient, projectIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (projectIds.length === 0) return out;
  const { data, error } = await db.rpc("geo_last_runs", { p_project_ids: projectIds });
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as Array<{ project_id: string; last_run_at: string }>) {
    out.set(String(r.project_id), new Date(String(r.last_run_at)).toISOString());
  }
  return out;
}
