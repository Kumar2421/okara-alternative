import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { sendGmail } from "@/lib/domain/leads/gmailSend";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import type { SupabaseClient } from "@supabase/supabase-js";

const SEND_CONCURRENCY = 3;

function mergeTags(template: string, lead: { name: string; company: string; title: string }): string {
  return template
    .replaceAll("{{name}}", lead.name || "")
    .replaceAll("{{company}}", lead.company || "")
    .replaceAll("{{title}}", lead.title || "");
}

/** Platform-mode Gmail token resolution — see the identical helper in
 * check-replies/route.ts for rationale (duplicated because gmailOAuth.ts is
 * SQLite-only and owned by a parallel migration cluster). */
async function getValidGmailAccessTokenSupabase(db: SupabaseClient, userId: string): Promise<string> {
  const { data: conn } = await db
    .from("integration_connections")
    .select("access_token_secret_id, refresh_token_secret_id, token_expiry")
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .maybeSingle();

  if (!conn?.access_token_secret_id) {
    throw new Error("Gmail isn't connected — connect it in Settings → API Credentials.");
  }

  const expiresAt = conn.token_expiry ? new Date(conn.token_expiry).getTime() : 0;
  if (Date.now() < expiresAt - 60_000) {
    const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.access_token_secret_id });
    if (secret) return secret as string;
  }

  if (!conn.refresh_token_secret_id) {
    throw new Error("Gmail isn't connected — connect it in Settings → API Credentials.");
  }
  const { data: refreshSecret } = await db.rpc("vault_get_secret", { p_id: conn.refresh_token_secret_id });
  const refreshToken = refreshSecret as string;
  if (!refreshToken) throw new Error("Gmail isn't connected — connect it in Settings → API Credentials.");

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET not set.");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Gmail token refresh failed: HTTP ${res.status}`);
  const data = await res.json();
  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  const { data: newSecretId } = await db.rpc("vault_set_secret", {
    p_secret: data.access_token,
    p_name: `gmail_access_token:${userId}:${Date.now()}`,
  });
  await db
    .from("integration_connections")
    .update({ access_token_secret_id: newSecretId as string, token_expiry: newExpiresAt })
    .eq("user_id", userId)
    .eq("provider", "gmail");

  return data.access_token as string;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Platform-mode inline copy of gmailSend.ts's sendGmail(), parameterized on
 * an access token instead of calling getValidGmailAccessToken() itself. */
async function sendGmailSupabase(
  accessToken: string,
  to: string,
  fromEmail: string,
  subject: string,
  body: string
): Promise<{ threadId: string; messageId: string }> {
  const message = [`From: ${fromEmail}`, `To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", body].join(
    "\r\n"
  );
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64UrlEncode(message) }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gmail send failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }
  const data = await res.json();
  return { threadId: data.threadId, messageId: data.id };
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

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { data: conn } = await db
      .from("integration_connections")
      .select("external_email")
      .eq("user_id", user.id)
      .eq("provider", "gmail")
      .maybeSingle();
    if (!conn?.external_email) {
      return NextResponse.json({ error: "Gmail isn't connected — connect it in Settings → API Credentials." }, { status: 422 });
    }
    const fromEmail = conn.external_email;

    const { data: leads, error: leadsError } = await db
      .from("leads")
      .select("id, name, company, title, email")
      .eq("user_id", user.id)
      .in("id", leadIds);
    if (leadsError) return NextResponse.json({ error: leadsError.message }, { status: 500 });

    let accessToken: string;
    try {
      accessToken = await getValidGmailAccessTokenSupabase(db, user.id);
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Gmail isn't connected." }, { status: 422 });
    }

    // No credit charge — sending an already-drafted email isn't a
    // generation action (the draft step was already charged).
    const results: { id: string; status: "sent" | "failed"; error?: string; threadId?: string; messageId?: string }[] = [];
    for (let i = 0; i < (leads ?? []).length; i += SEND_CONCURRENCY) {
      const batch = (leads ?? []).slice(i, i + SEND_CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (lead) => {
          if (!lead.email) return { id: lead.id, status: "failed" as const, error: "No email on this lead." };
          try {
            const { threadId, messageId } = await sendGmailSupabase(
              accessToken,
              lead.email,
              fromEmail,
              mergeTags(subjectTemplate, lead),
              mergeTags(bodyTemplate, lead)
            );
            return { id: lead.id, status: "sent" as const, threadId, messageId };
          } catch (err) {
            return { id: lead.id, status: "failed" as const, error: err instanceof Error ? err.message : String(err) };
          }
        })
      );
      results.push(...batchResults);
    }

    const now = new Date().toISOString();
    for (const r of results) {
      await db
        .from("leads")
        .update({
          email_status: r.status,
          emailed_at: r.status === "sent" ? now : null,
          gmail_thread_id: r.threadId ?? null,
          gmail_message_id: r.messageId ?? null,
        })
        .eq("user_id", user.id)
        .eq("id", r.id);
    }

    return NextResponse.json({ results });
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

  const results: { id: string; status: "sent" | "failed"; error?: string; threadId?: string; messageId?: string }[] = [];
  for (let i = 0; i < leads.length; i += SEND_CONCURRENCY) {
    const batch = leads.slice(i, i + SEND_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (lead) => {
        if (!lead.email) return { id: lead.id, status: "failed" as const, error: "No email on this lead." };
        try {
          const { threadId, messageId } = await sendGmail(
            lead.email,
            fromEmailRow.value,
            mergeTags(subjectTemplate, lead),
            mergeTags(bodyTemplate, lead)
          );
          return { id: lead.id, status: "sent" as const, threadId, messageId };
        } catch (err) {
          return { id: lead.id, status: "failed" as const, error: err instanceof Error ? err.message : String(err) };
        }
      })
    );
    results.push(...batchResults);
  }

  const now = new Date().toISOString();
  const update = db.prepare(
    "UPDATE leads SET email_status = ?, emailed_at = ?, gmail_thread_id = ?, gmail_message_id = ? WHERE id = ?"
  );
  for (const r of results) {
    update.run(r.status, r.status === "sent" ? now : null, r.threadId ?? null, r.messageId ?? null, r.id);
  }

  return NextResponse.json({ results });
}
