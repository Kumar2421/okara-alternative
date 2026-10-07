import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { runNotificationJob } from "./job";
import { LOCAL_USER_ID, sqliteNotificationStore } from "./notificationStore";
import { supabaseNotificationStore } from "./notificationStoreSupabase";
import type { NotificationStore } from "./ports";
import { emailLinksFor, notificationConfig } from "./runtime";
import { selfHostNotificationSource } from "./selfHostSource";

export type NotificationContext = {
  userId: string;
  store: NotificationStore;
  /** Where this user's emails go; null when unknown. */
  email: string | null;
};

/** The signed-in user (platform) or the one local user (self-host), with their notification store. Null: not signed in. */
export async function notificationContext(): Promise<NotificationContext | null> {
  if (!FEATURES.PLATFORM_MODE) {
    const db = getDb();
    const gmail = db.prepare("SELECT value FROM settings WHERE key = 'gmail_email'").get() as { value: string } | undefined;
    return {
      userId: LOCAL_USER_ID,
      store: sqliteNotificationStore(db),
      email: process.env.NOTIFY_TO_EMAIL?.trim() || gmail?.value || null,
    };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const db = createServiceClient();
  const { data: profile } = await db.from("profiles").select("email").eq("id", user.id).maybeSingle();
  return { userId: user.id, store: supabaseNotificationStore(db), email: profile?.email ? String(profile.email) : user.email ?? null };
}

const SELF_HOST_RUN_KEY = "notifications_last_run";
const SELF_HOST_RUN_EVERY_MS = 6 * 3600_000;

/**
 * Self-host has no scheduler, so the in-app list refreshes itself: at most
 * once every few hours, in the background, never blocking the request.
 */
export function maybeRunSelfHostJob(now = new Date()): void {
  if (FEATURES.PLATFORM_MODE) return;
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(SELF_HOST_RUN_KEY) as { value: string } | undefined;
  if (row && now.getTime() - Date.parse(row.value) < SELF_HOST_RUN_EVERY_MS) return;
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(SELF_HOST_RUN_KEY, now.toISOString());

  const config = notificationConfig();
  void runNotificationJob({
    source: selfHostNotificationSource(),
    store: sqliteNotificationStore(db),
    sender: config.sender,
    linksFor: (userId) => emailLinksFor(userId, config),
    now,
    budgetMs: 30_000,
    log: (message) => console.warn(`[notifications] ${message}`),
  }).catch((err) => console.warn("[notifications] self-host run failed:", err instanceof Error ? err.message : "unknown error"));
}
