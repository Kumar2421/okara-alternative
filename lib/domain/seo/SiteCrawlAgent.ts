import * as cheerio from "cheerio";
import { assertPublicHttpUrl } from "@/lib/domain/seo/SEOAgent";
import { jinaRead } from "@/lib/domain/shared/jinaReader";
import type { PageSpeedResult } from "@/lib/domain/seo/pageSpeedInsights";

export type CrawledPage = {
  url: string;
  title: string;
  content: string;
  source: "crawl" | "jina-fallback";
  /** Filled in only by the separate, explicit "Run PageSpeed" action (see
   * /api/agents/site-crawl/pagespeed) — real Lighthouse data per page, not
   * run automatically for every crawled page (PSI has real rate limits and
   * each call takes 10-20s). Absent until that action runs. */
  pageSpeed?: PageSpeedResult["pageSpeed"];
  pageSpeedError?: string;
};

const MIN_CONTENT_LENGTH = 200;
const PAGE_TIMEOUT_MS = 8000;
const MAX_PAGES = 8;
const SKIP_PATH_PATTERNS = [/\/(login|signup|sign-in|sign-up|logout)\/?($|[?#])/i];

async function cheapFetchPage(url: string): Promise<{ title: string; content: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "OkaraAlternative/1.0" }, signal: controller.signal });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript").remove();
    const content = $("body").text().replace(/\s+/g, " ").trim();
    return { title: $("title").text() || "", content };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Real multi-page site crawl, seeded from real internal links already
 * discovered on the main SEO audit (plain-crawl <a> tags, or Jina-extracted
 * markdown links when that page needed the SPA fallback — see SEOAgent.ts).
 * Each candidate page is fetched cheaply first; only falls back to Jina's
 * real headless render if that page's plain fetch also comes back too thin
 * — same reasoning as the single-page fallback, applied per page, so a
 * normal server-rendered site stays fast and a client-rendered one still
 * gets real content instead of an empty shell.
 *
 * Tavily's /crawl and /extract endpoints were tried first (same Tavily key
 * already wired into this app) and confirmed NOT to work on a real
 * client-rendered SPA test site — /crawl found 0 pages (nothing to follow
 * in the raw HTML) and /extract returned "Failed to fetch url" for known
 * real pages. Jina is what actually renders JS, so that's what this uses.
 */
export async function crawlSitePages(seedLinks: { href: string }[]): Promise<CrawledPage[]> {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const link of seedLinks) {
    if (candidates.length >= MAX_PAGES) break;
    if (seen.has(link.href) || SKIP_PATH_PATTERNS.some((p) => p.test(link.href))) continue;
    seen.add(link.href);
    candidates.push(link.href);
  }

  const pages: CrawledPage[] = [];
  for (const url of candidates) {
    try {
      assertPublicHttpUrl(url);
    } catch {
      continue;
    }

    const cheap = await cheapFetchPage(url);
    if (cheap && cheap.content.length >= MIN_CONTENT_LENGTH) {
      pages.push({ url, title: cheap.title, content: cheap.content.slice(0, 3000), source: "crawl" });
      continue;
    }

    // Jina's free-tier render is genuinely flaky on heavy SPAs — confirmed
    // for real: the same page succeeded on one run and returned empty on the
    // next, with no error, no pattern. One retry meaningfully improves yield
    // without much extra cost; still an honest partial result if both fail,
    // not a fabricated one.
    let jina = await jinaRead(url);
    if (!jina || jina.content.trim().length === 0) {
      jina = await jinaRead(url);
    }
    if (jina && jina.content.trim().length > 0) {
      pages.push({ url, title: jina.title, content: jina.content.slice(0, 3000), source: "jina-fallback" });
    }
  }
  return pages;
}
