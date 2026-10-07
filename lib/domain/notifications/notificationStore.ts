import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { normalizePrefs, type NotificationPrefs } from "./preferences.ts";
import type { NotificationStore, StoredPreferences } from "./ports.ts";
import { isNotificationKind, type Notification, type NotificationDraft, type NotificationKind } from "./types.ts";

/** Self-host has one user. */
export const LOCAL_USER_ID = "local";

type Row = {
  id: string; user_id: string; project_id: string | null; kind: string; dedupe_key: string; title: string; body: string;
  payload: string; created_at: string; read_at: string | null; emailed_at: string | null; email_error: string | null;
};

function safeJson(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toNotification(row: Row): Notification | null {
  if (!isNotificationKind(row.kind)) return null;
  return {
    id: row.id, userId: row.user_id, projectId: row.project_id, kind: row.kind, dedupeKey: row.dedupe_key,
    title: row.title, body: row.body, payload: safeJson(row.payload), createdAt: row.created_at,
    readAt: row.read_at, emailedAt: row.emailed_at, emailError: row.email_error,
  };
}

const present = (rows: Row[]) => rows.map(toNotification).filter((n): n is Notification => n !== null);

/** Self-host (SQLite) store. Takes the database explicitly so it can be tested against an in-memory one. */
export function sqliteNotificationStore(db: Database.Database): NotificationStore {
  return {
    async getPreferences(userId): Promise<StoredPreferences> {
      const row = db.prepare("SELECT prefs, unsubscribed_all FROM notification_preferences WHERE user_id = ?").get(userId) as
        | { prefs: string; unsubscribed_all: number } | undefined;
      return { prefs: normalizePrefs(row ? safeJson(row.prefs) : null), unsubscribedAll: row?.unsubscribed_all === 1 };
    },
    async savePreferences(userId, prefs: NotificationPrefs) {
      db.prepare(
        `INSERT INTO notification_preferences (user_id, prefs, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at`,
      ).run(userId, JSON.stringify(prefs), new Date().toISOString());
    },
    async setUnsubscribedAll(userId, value) {
      db.prepare(
        `INSERT INTO notification_preferences (user_id, unsubscribed_all, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET unsubscribed_all = excluded.unsubscribed_all, updated_at = excluded.updated_at`,
      ).run(userId, value ? 1 : 0, new Date().toISOString());
    },
    async record(userId: string, draft: NotificationDraft, now: Date) {
      const id = randomUUID();
      const result = db.prepare(
        `INSERT INTO notifications (id, user_id, project_id, kind, dedupe_key, title, body, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, dedupe_key) DO NOTHING`,
      ).run(id, userId, draft.projectId, draft.kind, draft.dedupeKey, draft.title, draft.body, JSON.stringify(draft.payload), now.toISOString());
      return result.changes > 0 ? { created: true, id } : { created: false, id: null };
    },
    async list(userId, opts) {
      return present(
        db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, opts?.limit ?? 50) as Row[],
      );
    },
    async unreadCount(userId) {
      return (db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").get(userId) as { n: number }).n;
    },
    async markRead(userId, ids, now) {
      if (ids === "all") {
        db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").run(now.toISOString(), userId);
        return;
      }
      const stmt = db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND id = ? AND read_at IS NULL");
      for (const id of ids) stmt.run(now.toISOString(), userId, id);
    },
    async listEmailPending(userId, sinceIso) {
      return present(
        db.prepare(
          "SELECT * FROM notifications WHERE user_id = ? AND emailed_at IS NULL AND email_error IS NULL AND created_at >= ? ORDER BY created_at",
        ).all(userId, sinceIso) as Row[],
      );
    },
    async markEmailed(userId, id, now, error) {
      if (error) db.prepare("UPDATE notifications SET email_error = ? WHERE user_id = ? AND id = ?").run(error, userId, id);
      else db.prepare("UPDATE notifications SET emailed_at = ? WHERE user_id = ? AND id = ?").run(now.toISOString(), userId, id);
    },
    async countEmailedSince(userId, kind: NotificationKind, sinceIso) {
      return (
        db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = ? AND emailed_at >= ?").get(userId, kind, sinceIso) as { n: number }
      ).n;
    },
  };
}
