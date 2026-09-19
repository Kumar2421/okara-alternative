import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { SEOAgent } from "@/lib/domain/seo/SEOAgent";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { chargeCredits, InsufficientCreditsError } from "@/lib/credits";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body || !body.url) {
    return NextResponse.json({ error: "Missing URL in request body" }, { status: 400 });
  }

  const { url } = body as { url: string };

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    const { data: projectSetting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const projectId = projectSetting?.value ?? null;
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });

    // Credit-metered — charge before running the crawl so a user out of
    // credits doesn't pay for the (potentially slow) real crawl work.
    try {
      await chargeCredits(user.id, "seo_audit", { projectId });
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        return NextResponse.json({ error: "Out of credits. Upgrade to run another SEO audit." }, { status: 402 });
      }
      throw err;
    }

    try {
      // PageSpeed key: same generic BYOK secret store used by
      // site-crawl/pagespeed — no dedicated schema table for non-LLM keys.
      const { data: conn } = await db
        .from("provider_connections")
        .select("api_key_secret_id")
        .eq("user_id", user.id)
        .eq("provider_id", "pagespeed_api_key")
        .maybeSingle();

      let pageSpeedApiKey: string | undefined = process.env.PAGESPEED_API_KEY || undefined;
      if (conn?.api_key_secret_id) {
        const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
        if (secret) pageSpeedApiKey = secret as string;
      }

      const agent = new SEOAgent(pageSpeedApiKey);
      const auditResult = await agent.audit(url);

      const createdAt = new Date().toISOString();
      const { error } = await db.from("seo_audits").upsert(
        { user_id: user.id, project_id: projectId, url, payload: auditResult, created_at: createdAt },
        { onConflict: "project_id,url" }
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      return NextResponse.json(auditResult);
    } catch (err) {
      // Note: credits already charged — no refund path yet on audit
      // failure. Follow-up, not blocking for this slice (same tradeoff as
      // the articles/generate route).
      const raw = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: raw }, { status: 500 });
    }
  }

  try {
    const db = getDb();

    // Settings table (user-entered, via Settings → API Credentials)
    // takes priority; env var is a fallback for anyone running this outside the UI.
    const stored = db.prepare("SELECT value FROM settings WHERE key = 'pagespeed_api_key'").get() as
      | { value: string }
      | undefined;
    const pageSpeedApiKey = stored?.value || process.env.PAGESPEED_API_KEY || undefined;

    const agent = new SEOAgent(pageSpeedApiKey);
    const auditResult = await agent.audit(url);

    const createdAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO seo_audits (url, payload, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        payload = excluded.payload,
        created_at = excluded.created_at
    `).run(url, JSON.stringify(auditResult), createdAt);

    return NextResponse.json(auditResult);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    const { data: projectSetting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const projectId = projectSetting?.value ?? null;

    try {
      if (url) {
        if (!projectId) return NextResponse.json({ error: "No audit found for this URL" }, { status: 404 });
        const { data: audit } = await db
          .from("seo_audits")
          .select("*")
          .eq("user_id", user.id)
          .eq("project_id", projectId)
          .eq("url", url)
          .maybeSingle();
        if (!audit) return NextResponse.json({ error: "No audit found for this URL" }, { status: 404 });
        return NextResponse.json(audit);
      } else {
        if (!projectId) return NextResponse.json({ audits: [] });
        const { data: audits, error } = await db
          .from("seo_audits")
          .select("*")
          .eq("user_id", user.id)
          .eq("project_id", projectId)
          .order("created_at", { ascending: false });
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ audits: audits ?? [] });
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: raw }, { status: 500 });
    }
  }

  try {
    const db = getDb();

    if (url) {
      const audit = db.prepare("SELECT * FROM seo_audits WHERE url = ?").get(url);
      if (!audit) return NextResponse.json({ error: "No audit found for this URL" }, { status: 404 });
      return NextResponse.json(audit);
    } else {
      const audits = db.prepare("SELECT * FROM seo_audits ORDER BY created_at DESC").all();
      return NextResponse.json({ audits });
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
