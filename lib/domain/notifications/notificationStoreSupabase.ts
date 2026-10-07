import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePrefs } from "./preferences.ts";
import type { NotificationStore, StoredPreferences } from "./ports.ts";
import { isNotificationKind, type Notification } from "./types.ts";

// Platform (Supabase) store. Uses the service-role client, so every query is
// scoped by user_id explicitly.

type Row = {
  id: string; user_id: string; project_id: string | null; kind: string; dedupe_key: string; title: string; body: string;
  payload: Record<string, unknown> | null; created_at: string; read_at: string | null; emailed_at: string | null; email_error: string | null;
  email_attempts: number | null; last_email_attempt_at: string | null;
};

function toNotification(row: Row): Notification | null {
  if (!isNotificationKind(row.kind)) return null;
  return {
    id: row.id, userId: row.user_id, projectId: row.project_id, kind: row.kind, dedupeKey: row.dedupe_key,
    title: row.title, body: row.body, payload: row.payload ?? {}, createdAt: row.created_at,
    readAt: row.read_at, emailedAt: row.emailed_at, emailError: row.email_error,
    emailAttempts: row.email_attempts ?? 0, lastEmailAttemptAt: row.last_email_attempt_at,
  };
}

const present = (rows: Row[] | null) => (rows ?? []).map(toNotification).filter((n): n is Notification => n !== null);

function check(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export function supabaseNotificationStore(db: SupabaseClient): NotificationStore {
  return {
    async getPreferences(userId): Promise<StoredPreferences> {
      const { data } = await db.from("notification_preferences").select("prefs, unsubscribed_all").eq("user_id", userId).maybeSingle();
      return { prefs: normalizePrefs(data?.prefs), unsubscribedAll: data?.unsubscribed_all === true };
    },
    async savePreferences(userId, prefs) {
      const { error } = await db.from("notification_preferences").upsert({ user_id: userId, prefs, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      check(error);
    },
    async setUnsubscribedAll(userId, value) {
      const { error } = await db.from("notification_preferences").upsert({ user_id: userId, unsubscribed_all: value, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      check(error);
    },
    async record(userId, draft, now) {
      const { data, error } = await db
        .from("notifications")
        .upsert(
          {
            user_id: userId, project_id: draft.projectId, kind: draft.kind, dedupe_key: draft.dedupeKey,
            title: draft.title, body: draft.body, payload: draft.payload, created_at: now.toISOString(),
          },
          { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
        )
        .select("id");
      check(error);
      const id = data?.[0]?.id;
      return id ? { created: true, id: String(id) } : { created: false, id: null };
    },
    async list(userId, opts) {
      const { data, error } = await db.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(opts?.limit ?? 50);
      check(error);
      return present(data as Row[] | null);
    },
    async unreadCount(userId) {
      const { count, error } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).is("read_at", null);
      check(error);
      return count ?? 0;
    },
    async markRead(userId, ids, now) {
      let query = db.from("notifications").update({ read_at: now.toISOString() }).eq("user_id", userId).is("read_at", null);
      if (ids !== "all") query = query.in("id", ids);
      const { error } = await query;
      check(error);
    },
    async listEmailPending(userId, sinceIso) {
      const { data, error } = await db
        .from("notifications").select("*").eq("user_id", userId).is("emailed_at", null).is("email_error", null).gte("created_at", sinceIso).order("created_at");
      check(error);
      return present(data as Row[] | null);
    },
    async markEmailed(userId, id, now, errorText) {
      const { error } = await db
        .from("notifications")
        .update(errorText ? { email_error: errorText } : { emailed_at: now.toISOString() })
        .eq("user_id", userId).eq("id", id);
      check(error);
    },
    async countEmailedSince(userId, kind, sinceIso) {
      const { count, error } = await db
        .from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("kind", kind).gte("emailed_at", sinceIso);
      check(error);
      return count ?? 0;
    },
    async noteEmailAttempt(userId, id, now) {
      const { data, error: readError } = await db.from("notifications").select("email_attempts").eq("user_id", userId).eq("id", id).maybeSingle();
      check(readError);
      const { error } = await db
        .from("notifications")
        .update({ email_attempts: Number(data?.email_attempts ?? 0) + 1, last_email_attempt_at: now.toISOString() })
        .eq("user_id", userId).eq("id", id);
      check(error);
    },
    async hasKey(userId, dedupeKey) {
      const { count, error } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("dedupe_key", dedupeKey);
      check(error);
      return (count ?? 0) > 0;
    },
    async lastRuns(userIds) {
      const out = new Map<string, string | null>(userIds.map((id) => [id, null]));
      // Chunked so the id list never blows the request URL length.
      for (let i = 0; i < userIds.length; i += 100) {
        const { data, error } = await db.from("notification_preferences").select("user_id, last_run_at").in("user_id", userIds.slice(i, i + 100));
        check(error);
        for (const row of data ?? []) out.set(String(row.user_id), row.last_run_at ? String(row.last_run_at) : null);
      }
      return out;
    },
    async stampRun(userId, now) {
      const { error } = await db.from("notification_preferences").upsert({ user_id: userId, last_run_at: now.toISOString() }, { onConflict: "user_id" });
      check(error);
    },
    async claimTestSend(userId, now, minGapMs) {
      const ensure = await db.from("notification_preferences").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
      check(ensure.error);
      const cutoff = new Date(now.getTime() - minGapMs).toISOString();
      // One conditional UPDATE: only one concurrent caller can match the row.
      const { data, error } = await db
        .from("notification_preferences")
        .update({ last_test_email_at: now.toISOString() })
        .eq("user_id", userId)
        .or(`last_test_email_at.is.null,last_test_email_at.lt.${cutoff}`)
        .select("user_id");
      check(error);
      return (data?.length ?? 0) > 0;
    },
  };
}
