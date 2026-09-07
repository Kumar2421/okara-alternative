import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { sendGmail } from "@/lib/domain/leads/gmailSend";

const SEND_CONCURRENCY = 3;

function mergeTags(template: string, lead: { name: string; company: string; title: string }): string {
  return template
    .replaceAll("{{name}}", lead.name || "")
    .replaceAll("{{company}}", lead.company || "")
    .replaceAll("{{title}}", lead.title || "");
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const leadIds: string[] = Array.isArray(body?.leadIds) ? body.leadIds : [];
  const subjectTemplate: string = typeof body?.subject === "string" ? body.subject : "";
  const bodyTemplate: string = typeof body?.body === "string" ? body.body : "";

  if (leadIds.length === 0) {
    return NextResponse.json({ error: "No leads selected." }, { status: 400 });
  }
  if (!subjectTemplate.trim() || !bodyTemplate.trim()) {
    return NextResponse.json({ error: "Subject and body are required." }, { status: 400 });
  }

  const db = getDb();
  const fromEmailRow = db.prepare("SELECT value FROM settings WHERE key = 'gmail_email'").get() as
    | { value: string }
    | undefined;
  if (!fromEmailRow?.value) {
    return NextResponse.json({ error: "Gmail isn't connected — connect it in Settings → API Credentials." }, { status: 422 });
  }

  const placeholders = leadIds.map(() => "?").join(",");
  const leads = db
    .prepare(`SELECT id, name, company, title, email FROM leads WHERE id IN (${placeholders})`)
    .all(...leadIds) as { id: string; name: string; company: string; title: string; email: string | null }[];

  const results: { id: string; status: "sent" | "failed"; error?: string }[] = [];
  for (let i = 0; i < leads.length; i += SEND_CONCURRENCY) {
    const batch = leads.slice(i, i + SEND_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (lead) => {
        if (!lead.email) return { id: lead.id, status: "failed" as const, error: "No email on this lead." };
        try {
          await sendGmail(lead.email, fromEmailRow.value, mergeTags(subjectTemplate, lead), mergeTags(bodyTemplate, lead));
          return { id: lead.id, status: "sent" as const };
        } catch (err) {
          return { id: lead.id, status: "failed" as const, error: err instanceof Error ? err.message : String(err) };
        }
      })
    );
    results.push(...batchResults);
  }

  const now = new Date().toISOString();
  const update = db.prepare("UPDATE leads SET email_status = ?, emailed_at = ? WHERE id = ?");
  for (const r of results) {
    update.run(r.status, r.status === "sent" ? now : null, r.id);
  }

  return NextResponse.json({ results });
}
