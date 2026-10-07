import { defaultPrefs, type NotificationPrefs } from "./preferences.ts";
import type { EmailMessage, EmailSender, NotificationStore, SendResult, StoredPreferences } from "./ports.ts";
import type { Notification, NotificationDraft, NotificationKind } from "./types.ts";

/** Records every message; `results` is consumed in order, then it succeeds. For tests. */
export class FakeEmailSender implements EmailSender {
  sent: EmailMessage[] = [];
  results: SendResult[] = [];
  async send(message: EmailMessage): Promise<SendResult> {
    this.sent.push(message);
    return this.results.shift() ?? { ok: true, id: `fake-${this.sent.length}` };
  }
}

/** In-memory store with the same semantics as the real ones (dedupe per user, read/emailed stamps). For tests. */
export class MemoryNotificationStore implements NotificationStore {
  rows: Notification[] = [];
  private prefs = new Map<string, StoredPreferences>();
  private seq = 0;

  async getPreferences(userId: string): Promise<StoredPreferences> {
    return this.prefs.get(userId) ?? { prefs: defaultPrefs(), unsubscribedAll: false };
  }
  async savePreferences(userId: string, prefs: NotificationPrefs): Promise<void> {
    this.prefs.set(userId, { prefs, unsubscribedAll: (await this.getPreferences(userId)).unsubscribedAll });
  }
  async setUnsubscribedAll(userId: string, value: boolean): Promise<void> {
    this.prefs.set(userId, { prefs: (await this.getPreferences(userId)).prefs, unsubscribedAll: value });
  }
  async record(userId: string, draft: NotificationDraft, now: Date) {
    if (this.rows.some((r) => r.userId === userId && r.dedupeKey === draft.dedupeKey)) return { created: false, id: null };
    const id = `n${++this.seq}`;
    this.rows.push({ ...draft, id, userId, createdAt: now.toISOString(), readAt: null, emailedAt: null, emailError: null });
    return { created: true, id };
  }
  async list(userId: string, opts?: { limit?: number }) {
    return this.rows.filter((r) => r.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, opts?.limit ?? 50);
  }
  async unreadCount(userId: string) {
    return this.rows.filter((r) => r.userId === userId && !r.readAt).length;
  }
  async markRead(userId: string, ids: string[] | "all", now: Date) {
    for (const r of this.rows) if (r.userId === userId && !r.readAt && (ids === "all" || ids.includes(r.id))) r.readAt = now.toISOString();
  }
  async listEmailPending(userId: string, sinceIso: string) {
    return this.rows.filter((r) => r.userId === userId && !r.emailedAt && !r.emailError && r.createdAt >= sinceIso);
  }
  async markEmailed(userId: string, id: string, now: Date, error: string | null) {
    const row = this.rows.find((r) => r.userId === userId && r.id === id);
    if (!row) return;
    if (error) row.emailError = error;
    else row.emailedAt = now.toISOString();
  }
  async countEmailedSince(userId: string, kind: NotificationKind, sinceIso: string) {
    return this.rows.filter((r) => r.userId === userId && r.kind === kind && r.emailedAt && r.emailedAt >= sinceIso).length;
  }
}
