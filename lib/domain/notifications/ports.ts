import type { NotificationPrefs } from "./preferences.ts";
import type { Notification, NotificationDraft, NotificationKind } from "./types.ts";

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  /** Same key on a retry means the provider will not send twice. */
  idempotencyKey: string;
};

export type SendResult =
  | { ok: true; id: string }
  /** `retryable`: a network or provider hiccup worth trying again later; otherwise the email is given up on. */
  | { ok: false; error: string; retryable: boolean };

/** Sends one email. The "from" address and credentials live inside the adapter, never in messages or logs. */
export interface EmailSender {
  send(message: EmailMessage): Promise<SendResult>;
}

/** Records an in-app notification. A repeat of the same dedupe key stores nothing. */
export interface InAppSink {
  record(userId: string, draft: NotificationDraft, now: Date): Promise<{ created: boolean; id: string | null }>;
}

export type StoredPreferences = { prefs: NotificationPrefs; unsubscribedAll: boolean };

/** Persistence for preferences and notifications. Supabase (platform) and SQLite (self-host) each implement it. */
export interface NotificationStore extends InAppSink {
  getPreferences(userId: string): Promise<StoredPreferences>;
  savePreferences(userId: string, prefs: NotificationPrefs): Promise<void>;
  setUnsubscribedAll(userId: string, value: boolean): Promise<void>;
  list(userId: string, opts?: { limit?: number }): Promise<Notification[]>;
  unreadCount(userId: string): Promise<number>;
  /** Mark specific notifications read, or all of the user's when `ids` is "all". */
  markRead(userId: string, ids: string[] | "all", now: Date): Promise<void>;
  /** Not yet emailed, not given up on, created since `sinceIso`. */
  listEmailPending(userId: string, sinceIso: string): Promise<Notification[]>;
  /** Stamp as emailed, or, with an error, give up on emailing it. */
  markEmailed(userId: string, id: string, now: Date, error: string | null): Promise<void>;
  countEmailedSince(userId: string, kind: NotificationKind, sinceIso: string): Promise<number>;
}
