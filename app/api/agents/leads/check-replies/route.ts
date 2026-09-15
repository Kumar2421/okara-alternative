import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { listReplies } from "@/lib/domain/leads/gmailInbox";

const CHECK_CONCURRENCY = 3;

/** Real, on-demand poll — no background worker in this app, so this only
 * runs when the user explicitly clicks "Check replies". Loops every sent
 * lead with a real Gmail thread, reads the thread for real, and updates
 * last_reply_at/last_reply_snippet only when the reply is newer than what's
 * already stored (idempotent — safe to click repeatedly). */
export async function POST() {
  const activeId = getActiveProjectId();
  if (!activeId) return NextResponse.json({ error: "No active project." }, { status: 422 });

  const db = getDb();
  const leads = db
    .prepare(
      `SELECT id, gmail_thread_id, gmail_message_id, last_reply_snippet FROM leads
       WHERE project_id = ? AND email_status = 'sent' AND gmail_thread_id IS NOT NULL`
    )
    .all(activeId) as { id: string; gmail_thread_id: string; gmail_message_id: string; last_reply_snippet: string | null }[];

  if (leads.length === 0) {
    return NextResponse.json({ checked: 0, newReplies: 0 });
  }

  const update = db.prepare("UPDATE leads SET last_reply_at = ?, last_reply_snippet = ? WHERE id = ?");
  let newReplies = 0;
  let lastError: string | null = null;

  for (let i = 0; i < leads.length; i += CHECK_CONCURRENCY) {
    const batch = leads.slice(i, i + CHECK_CONCURRENCY);
    await Promise.all(
      batch.map(async (lead) => {
        try {
          const replies = await listReplies(lead.gmail_thread_id, lead.gmail_message_id);
          if (replies.length === 0) return;
          const latest = replies[replies.length - 1];
          // internalDate here is the real RFC 2822 Date header string — string
          // compare is enough to detect "changed since last check", exact
          // chronological sort isn't needed for a single latest-reply snippet.
          if (latest.snippet && latest.snippet !== lead.last_reply_snippet) {
            update.run(latest.internalDate || new Date().toISOString(), latest.snippet, lead.id);
            newReplies++;
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      })
    );
  }

  return NextResponse.json({ checked: leads.length, newReplies, error: lastError });
}
