import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { LeadsAgent, type ExtractedLead } from "@/lib/domain/leads/LeadsAgent";
import { guessAndVerifyEmail } from "@/lib/domain/leads/emailVerify";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { chargeCredits, InsufficientCreditsError } from "@/lib/credits";
import type { SupabaseClient } from "@supabase/supabase-js";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

/** Platform-mode equivalent of getActiveProjectId() — reads the same
 * "active_project_id" key, just scoped to user_settings (per-user) instead
 * of the shared local SQLite settings table. */
async function getActiveProjectIdSupabase(db: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await db
    .from("user_settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", "active_project_id")
    .maybeSingle();
  return data?.value ?? null;
}

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
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const activeId = await getActiveProjectIdSupabase(db, user.id);
    if (!activeId) return NextResponse.json({ leads: [] });

    const { data: rows, error } = await db
      .from("leads")
      .select("*")
      .eq("user_id", user.id)
      .eq("project_id", activeId)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ leads: rows ?? [] });
  }

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

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    // Tavily key: secret, stored via the same generic BYOK store as LLM
    // provider keys (provider_connections isn't LLM-specific — see /api/providers).
    const { data: tavilyConn } = await db
      .from("provider_connections")
      .select("api_key_secret_id")
      .eq("user_id", user.id)
      .eq("provider_id", "tavily")
      .maybeSingle();
    if (!tavilyConn?.api_key_secret_id) {
      return NextResponse.json(
        { error: "Connect a Tavily API key in Settings → API Credentials to search for real leads." },
        { status: 422 }
      );
    }
    const { data: tavilySecret } = await db.rpc("vault_get_secret", { p_id: tavilyConn.api_key_secret_id });
    const tavilyKey = (tavilySecret as string) ?? "";

    // LLM provider key — BYOK only for this route (no platform-provided
    // fallback specified for lead search).
    const { data: providerConn } = await db
      .from("provider_connections")
      .select("api_key_secret_id, base_url")
      .eq("user_id", user.id)
      .eq("provider_id", providerId)
      .maybeSingle();
    if (!providerConn?.api_key_secret_id) {
      return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });
    }
    const { data: providerSecret } = await db.rpc("vault_get_secret", { p_id: providerConn.api_key_secret_id });
    const providerApiKey = (providerSecret as string) ?? "";

    // Optional Google CSE fallback: apiKey is a secret (reuse the same
    // "google_cloud" provider_connections row used by places-search); cx is
    // a non-secret identifier, stored as plain user_settings (same generic
    // per-user key/value store used for primaryModel / active_project_id).
    const { data: googleConn } = await db
      .from("provider_connections")
      .select("api_key_secret_id")
      .eq("user_id", user.id)
      .eq("provider_id", "google_cloud")
      .maybeSingle();
    const { data: googleCxSetting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "google_cse_id")
      .maybeSingle();
    let google: { apiKey: string; cx: string } | undefined;
    if (googleConn?.api_key_secret_id && googleCxSetting?.value) {
      const { data: googleSecret } = await db.rpc("vault_get_secret", { p_id: googleConn.api_key_secret_id });
      if (googleSecret) google = { apiKey: googleSecret as string, cx: googleCxSetting.value };
    }

    const activeId = await getActiveProjectIdSupabase(db, user.id);
    if (!activeId) {
      return NextResponse.json({ error: "No active project. Link a website first." }, { status: 422 });
    }

    try {
      await chargeCredits(user.id, "lead_search", { projectId: activeId, model });
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        return NextResponse.json({ error: "Out of credits. Upgrade or connect your own key." }, { status: 402 });
      }
      throw err;
    }

    try {
      const agent = new LeadsAgent(driver, providerApiKey, providerConn.base_url ?? undefined);
      const query = `${role} ${companyOrIndustry} ${location}`.trim();
      const leads = await agent.search({ role, companyOrIndustry, location }, tavilyKey, model, google);

      const verifiedEmails = await verifyMissingEmails(leads);

      const now = new Date().toISOString();
      const rowsToInsert = leads.map((lead, index) => {
        const verifiedEmail = verifiedEmails.get(index);
        const email = lead.email ?? verifiedEmail ?? null;
        const emailVerified = !lead.email && !!verifiedEmail;
        return {
          user_id: user.id,
          project_id: activeId,
          name: lead.name,
          title: lead.title,
          company: lead.company,
          location: lead.location,
          email,
          email_verified: emailVerified,
          source_url: lead.sourceUrl,
          query,
          created_at: now,
        };
      });

      const { data: saved, error } = await db.from("leads").insert(rowsToInsert).select();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      return NextResponse.json({ leads: saved });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: raw }, { status: 502 });
    }
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

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { error } = await db.from("leads").delete().eq("user_id", user.id).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  }

  const db = getDb();
  db.prepare("DELETE FROM leads WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
