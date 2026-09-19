import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { CrawledPage } from "@/lib/domain/seo/SiteCrawlAgent";
import { fetchPageSpeed } from "@/lib/domain/seo/pageSpeedInsights";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

/**
 * Real PageSpeed Insights for the pages already found by the Site Pages
 * crawl — a separate, explicit action from that crawl itself (and from the
 * homepage's own PageSpeed check) because PSI has real rate limits and each
 * call takes 10-20s; running it automatically for every discovered page
 * would be slow and could burn through quota without the user asking for it.
 * Runs sequentially, not in parallel, for the same reason.
 *
 * // free in platform mode for now — no credit_costs entry yet
 */
export async function POST() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    // PageSpeed key: reusing the generic BYOK secret store (provider_connections
    // + Vault) that /api/providers already uses for LLM keys, under a
    // dedicated provider_id — there's no separate schema table for
    // non-LLM API keys, and this is the same real pattern used to decrypt
    // a BYOK key in the articles route.
    const { data: conn } = await db
      .from("provider_connections")
      .select("api_key_secret_id")
      .eq("user_id", user.id)
      .eq("provider_id", "pagespeed_api_key")
      .maybeSingle();
    if (!conn?.api_key_secret_id) {
      return NextResponse.json(
        { error: "Connect a PageSpeed API key in Settings → API Credentials to run real Lighthouse scores." },
        { status: 422 }
      );
    }
    const { data: secret, error: secretError } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
    if (secretError || !secret) {
      return NextResponse.json(
        { error: "Connect a PageSpeed API key in Settings → API Credentials to run real Lighthouse scores." },
        { status: 422 }
      );
    }
    const apiKey = secret as string;

    const { data: projectSetting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const projectId = projectSetting?.value ?? null;
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });

    const { data: crawlRow } = await db
      .from("site_crawls")
      .select("payload, checked_at")
      .eq("user_id", user.id)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!crawlRow) {
      return NextResponse.json(
        { error: "No crawled pages yet — run \"Crawl full site\" first." },
        { status: 422 }
      );
    }

    const pages: CrawledPage[] = crawlRow.payload;

    for (const page of pages) {
      try {
        const result = await fetchPageSpeed(page.url, apiKey);
        page.pageSpeed = result.pageSpeed;
        page.pageSpeedError = undefined;
      } catch (e) {
        page.pageSpeedError = e instanceof Error ? e.message : "PageSpeed fetch failed";
      }
    }

    const now = new Date().toISOString();
    const { error } = await db
      .from("site_crawls")
      .update({ payload: pages, checked_at: now })
      .eq("user_id", user.id)
      .eq("project_id", projectId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ result: { pages, checkedAt: now } });
  }

  const db = getDb();

  const keyRow = db.prepare("SELECT value FROM settings WHERE key = 'pagespeed_api_key'").get() as
    | { value: string }
    | undefined;
  if (!keyRow?.value) {
    return NextResponse.json(
      { error: "Connect a PageSpeed API key in Settings → API Credentials to run real Lighthouse scores." },
      { status: 422 }
    );
  }

  const activeId = getActiveProjectId();
  if (!activeId) {
    return NextResponse.json({ error: "No active project." }, { status: 422 });
  }

  const crawlRow = db.prepare("SELECT payload, checked_at FROM site_crawls WHERE project_id = ?").get(activeId) as
    | { payload: string; checked_at: string }
    | undefined;
  if (!crawlRow) {
    return NextResponse.json(
      { error: "No crawled pages yet — run \"Crawl full site\" first." },
      { status: 422 }
    );
  }

  const pages: CrawledPage[] = JSON.parse(crawlRow.payload);

  for (const page of pages) {
    try {
      const result = await fetchPageSpeed(page.url, keyRow.value);
      page.pageSpeed = result.pageSpeed;
      page.pageSpeedError = undefined;
    } catch (e) {
      page.pageSpeedError = e instanceof Error ? e.message : "PageSpeed fetch failed";
    }
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE site_crawls SET payload = ?, checked_at = ? WHERE project_id = ?").run(
    JSON.stringify(pages),
    now,
    activeId
  );

  return NextResponse.json({ result: { pages, checkedAt: now } });
}
