import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { CrawledPage } from "@/lib/domain/seo/SiteCrawlAgent";
import { fetchPageSpeed } from "@/lib/domain/seo/pageSpeedInsights";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

/**
 * Real PageSpeed Insights for the pages already found by the Site Pages
 * crawl — a separate, explicit action from that crawl itself (and from the
 * homepage's own PageSpeed check) because PSI has real rate limits and each
 * call takes 10-20s; running it automatically for every discovered page
 * would be slow and could burn through quota without the user asking for it.
 * Runs sequentially, not in parallel, for the same reason.
 */
export async function POST() {
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
