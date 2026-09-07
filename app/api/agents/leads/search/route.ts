import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { LeadsAgent, type ExtractedLead } from "@/lib/domain/leads/LeadsAgent";
import { guessAndVerifyEmail } from "@/lib/domain/leads/emailVerify";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

const SMTP_VERIFY_CONCURRENCY = 5;

/** Runs guessAndVerifyEmail only for leads search extraction left with no
 * email — bounded concurrency so we're not opening dozens of SMTP sockets
 * at once. Mutates nothing; returns which leads got a verified email. */
async function verifyMissingEmails(leads: ExtractedLead[]): Promise<Map<number, string>> {
  const verified = new Map<number, string>();
  const candidates = leads
    .map((lead, index) => ({ lead, index }))
    .filter(({ lead }) => !lead.email && lead.company && lead.name.trim().split(/\s+/).length >= 2);

  for (let i = 0; i < candidates.length; i += SMTP_VERIFY_CONCURRENCY) {
    const batch = candidates.slice(i, i + SMTP_VERIFY_CONCURRENCY);
    const results = await Promise.all(
      batch.map(({ lead }) => guessAndVerifyEmail(lead.name, lead.company).catch(() => null))
    );
    results.forEach((email, j) => {
      if (email) verified.set(batch[j].index, email);
    });
  }
  return verified;
}

export async function GET() {
  const activeId = getActiveProjectId();
  if (!activeId) return NextResponse.json({ leads: [] });

  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM leads WHERE project_id = ? ORDER BY created_at DESC")
    .all(activeId);

  return NextResponse.json({ leads: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const role: string = typeof body?.role === "string" ? body.role.trim() : "";
  const companyOrIndustry: string = typeof body?.companyOrIndustry === "string" ? body.companyOrIndustry.trim() : "";
  const location: string = typeof body?.location === "string" ? body.location.trim() : "";
  const providerId: string | undefined = body?.providerId;
  const model: string | undefined = body?.model;

  if (!role && !companyOrIndustry) {
    return NextResponse.json({ error: "Enter at least a role or a company/industry to search for." }, { status: 400 });
  }
  if (!model || !providerId) {
    return NextResponse.json(
      { error: "No model selected. Connect a provider in Settings → LLM Providers." },
      { status: 422 }
    );
  }

  const driver = getDriver(providerId);
  if (!driver) {
    return NextResponse.json({ error: `${providerId} isn't wired to a real model yet.` }, { status: 501 });
  }

  const db = getDb();

  const tavilyKeyRow = db.prepare("SELECT value FROM settings WHERE key = 'tavily_api_key'").get() as
    | { value: string }
    | undefined;
  if (!tavilyKeyRow?.value) {
    return NextResponse.json(
      { error: "Connect a Tavily API key in Settings → API Credentials to search for real leads." },
      { status: 422 }
    );
  }

  const keyRow = db
    .prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?")
    .get(providerId) as { api_key: string; base_url: string | null } | undefined;
  if (!keyRow) {
    return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });
  }

  const googleKeyRow = db.prepare("SELECT value FROM settings WHERE key = 'google_cloud_api_key'").get() as
    | { value: string }
    | undefined;
  const googleCxRow = db.prepare("SELECT value FROM settings WHERE key = 'google_cse_id'").get() as
    | { value: string }
    | undefined;
  const google = googleKeyRow?.value && googleCxRow?.value ? { apiKey: googleKeyRow.value, cx: googleCxRow.value } : undefined;

  const activeId = getActiveProjectId();
  if (!activeId) {
    return NextResponse.json({ error: "No active project. Link a website first." }, { status: 422 });
  }

  try {
    const agent = new LeadsAgent(driver, keyRow.api_key, keyRow.base_url ?? undefined);
    const query = `${role} ${companyOrIndustry} ${location}`.trim();
    const leads = await agent.search({ role, companyOrIndustry, location }, tavilyKeyRow.value, model, google);

    // Tier 1: for leads search left with no email, try a real SMTP-verified
    // guess (see emailVerify.ts) — never overrides an email search already
    // found, only upgrades a null.
    const verifiedEmails = await verifyMissingEmails(leads);

    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO leads (id, project_id, name, title, company, location, email, email_verified, source_url, query, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const saved = leads.map((lead, index) => {
      const id = `lead_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const verifiedEmail = verifiedEmails.get(index);
      const email = lead.email ?? verifiedEmail ?? null;
      const emailVerified = !lead.email && !!verifiedEmail;
      insert.run(id, activeId, lead.name, lead.title, lead.company, lead.location, email, emailVerified ? 1 : 0, lead.sourceUrl, query, now);
      return { id, project_id: activeId, ...lead, email, email_verified: emailVerified, query, created_at: now };
    });

    return NextResponse.json({ leads: saved });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param is required" }, { status: 400 });

  const db = getDb();
  db.prepare("DELETE FROM leads WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
