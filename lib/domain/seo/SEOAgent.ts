import * as cheerio from "cheerio";
import { request as httpRequest, type IncomingHttpHeaders } from "http";
import { request as httpsRequest } from "https";
import { jinaRead, extractMarkdownLinks } from "@/lib/domain/shared/jinaReader";
import { fetchPageSpeed, type CwvSnapshot } from "@/lib/domain/seo/pageSpeedInsights";

export type { CwvStatus, CwvMetric, CwvSnapshot } from "@/lib/domain/seo/pageSpeedInsights";

export type SEOAuditPayload = {
  url: string;
  meta: {
    title: string;
    description: string;
  };
  headings: {
    h1: number;
    h2: number;
    h3: number;
  };
  openGraph: { key: string; value: string; ok: boolean }[];
  twitter: { key: string; value: string; ok: boolean }[];
  issues: { label: string; level: "Warning" | "Error" }[];
  /** Undefined (not a fake fallback) when no PageSpeed key is connected, or
   * the real PSI call failed — the frontend shows a real crawl-derived
   * substitute instead of ever presenting invented Lighthouse-shaped numbers. */
  pageSpeed?: {
    desktop: { performance: number; accessibility: number; bestPractices: number; seo: number };
    mobile: { performance: number; accessibility: number; bestPractices: number; seo: number };
  };
  coreWebVitals?: {
    desktop: CwvSnapshot;
    mobile: CwvSnapshot;
  };
  /** Visible page text (script/style stripped, whitespace collapsed, capped
   * at ~6000 chars) — the raw material downstream doc generators (Product
   * Information, Marketing Strategy, ...) ground their output in, instead of
   * inferring content from meta tags alone. Not shown in the SEO UI itself. */
  bodyText: string;
  /** "jina-fallback" when the plain crawl came back too thin to be useful
   * (a client-rendered SPA with an empty server-rendered shell) and Jina's
   * real headless-browser render was used instead — bodyText/links reflect
   * the Jina result in that case, not the raw HTML. */
  contentSource: "crawl" | "jina-fallback";
  /** Real, cheerio-extracted visual signals — no computed styles (would need
   * a headless browser), so every field is optional. The Design Guide
   * generator must say "Not stated on the page" for anything missing here
   * rather than invent it. */
  design: {
    /** From <meta name="theme-color">, if present. */
    themeColor?: string;
    /** Font family names parsed out of Google Fonts <link> hrefs — reliable
     * when present since the URL itself names the font, no guessing. */
    fonts: string[];
    /** Best-effort logo <img> (alt/src/class containing "logo"), resolved to
     * an absolute URL. */
    logoUrl?: string;
    /** <link rel="icon"> / "shortcut icon">, resolved to an absolute URL. */
    faviconUrl?: string;
  };
  /** Real response-level signals — headers + byte counts from the actual
   * crawl response, cheerio element counts. onPageScore is a deterministic
   * "checks passed" percentage over things this crawl can actually verify —
   * not a Lighthouse-equivalent score, just an honest on-page checklist. */
  technical: {
    onPageScore: number;
    server?: string;
    status: number;
    encoding?: string;
    pageSizeBytes: number;
    domSize: number;
    cacheable: boolean;
    /** Real hops followed to reach the final page — 0 means no redirect. */
    redirectCount: number;
    /** Real robots.txt fetch+parse (User-agent: * group only) — whether the
     * file exists at all, and whether it disallows the crawled path. Doesn't
     * block the crawl (this is the owner auditing their own site), just reports it. */
    robotsTxt: { exists: boolean; disallowsThisPage: boolean };
  };
  /** Real network-phase timings from a raw Node http(s) request — connect/TLS/
   * TTFB/download are genuinely measurable server-side. "Time to Interactive"
   * and "DOM Complete" are NOT included here: those are rendering/JS-execution
   * concepts a server-side crawl can't see without a real browser (Core Web
   * Vitals above already covers that, via real Lighthouse data when a
   * PageSpeed key is connected — no point faking a second version of it). */
  serverTiming: {
    connectMs?: number;
    tlsHandshakeMs?: number;
    ttfbMs?: number;
    downloadMs?: number;
  };
  renderBlocking: {
    blockingScripts: number;
    blockingStylesheets: number;
  };
  /** Deterministic keyword-overlap % between meta tags and body text — real
   * and reproducible, not an LLM guess that could vary run to run. */
  contentRelevance: {
    titleRelevance: number;
    descriptionRelevance: number;
    keywordRelevance: number;
  };
  /** Real <a href> links extracted from the crawl — capped, classified
   * internal/external. Reachability is NOT checked here (that's a separate,
   * explicit, bounded action — see /api/agents/links/check — so a routine
   * audit doesn't silently fire dozens of extra requests). */
  links: { href: string; text: string; internal: boolean }[];
};

const REQUIRED_OG_TAGS = ["og:title", "og:description", "og:image"];
const REQUIRED_TWITTER_TAGS = ["twitter:card"];

const CRAWL_TIMEOUT_MS = 10_000;

/** Blocks obvious SSRF targets (localhost, private ranges, link-local, non-http
 * schemes). Not exhaustive DNS-rebinding protection, but stops the easy cases
 * before the server fetches an attacker-supplied URL. */
export function assertPublicHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }

  const host = parsed.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (isPrivate) {
    throw new Error("URLs pointing to local/private addresses are not allowed");
  }

  return parsed;
}

type FetchTiming = {
  connectMs?: number;
  tlsHandshakeMs?: number;
  ttfbMs?: number;
  downloadMs?: number;
};

type TimedFetchResult = {
  html: string;
  status: number;
  headers: IncomingHttpHeaders;
  timing: FetchTiming;
  redirectCount: number;
};

/** Real network-phase timing (connect/TLS/TTFB/download) requires the raw
 * socket lifecycle events — plain fetch() doesn't expose them. This is the
 * one and only crawl request (not a second call just for timing): its HTML
 * is what cheerio parses everything else from. */
const MAX_REDIRECTS = 5;

/** Unlike fetch(), Node's raw http(s).request doesn't follow redirects —
 * real sites redirect constantly (http→https, apex↔www, trailing slash), so
 * this has to be handled explicitly or the crawl breaks for most of them.
 * Only the timing of the FINAL hop is reported (that's the one whose HTML we
 * actually use), which is honest — real total time is expected to be dominated
 * by that connection, not the redirect hops. */
async function timedFetch(url: URL, timeoutMs: number, redirectsLeft = MAX_REDIRECTS, hopsSoFar = 0): Promise<TimedFetchResult> {
  const result = await timedFetchOnce(url, timeoutMs);
  const location = result.headers.location;
  if (result.status >= 300 && result.status < 400 && location && redirectsLeft > 0) {
    const nextUrl = new URL(location, url);
    assertPublicHttpUrl(nextUrl.toString());
    return timedFetch(nextUrl, timeoutMs, redirectsLeft - 1, hopsSoFar + 1);
  }
  return { ...result, redirectCount: hopsSoFar };
}

function timedFetchOnce(url: URL, timeoutMs: number): Promise<TimedFetchResult> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === "https:";
    const reqFn = isHttps ? httpsRequest : httpRequest;
    const start = process.hrtime.bigint();
    let lookupStart: bigint | undefined;
    let connectStartAt: bigint | undefined;
    let tlsStart: bigint | undefined;
    let connectMs: number | undefined;
    let tlsHandshakeMs: number | undefined;

    const req = reqFn(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: "GET",
        headers: { "User-Agent": "OkaraAlternative/1.0" },
        timeout: timeoutMs,
      },
      (res) => {
        const ttfbMs = Number(process.hrtime.bigint() - start) / 1e6;
        const chunks: Buffer[] = [];
        const downloadStart = process.hrtime.bigint();
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            html: Buffer.concat(chunks).toString("utf8"),
            status: res.statusCode ?? 0,
            headers: res.headers,
            timing: {
              connectMs,
              tlsHandshakeMs,
              ttfbMs,
              downloadMs: Number(process.hrtime.bigint() - downloadStart) / 1e6,
            },
            redirectCount: 0, // overwritten by timedFetch() once the real hop count is known
          });
        });
        res.on("error", reject);
      }
    );

    req.on("socket", (socket) => {
      socket.once("lookup", () => {
        lookupStart = process.hrtime.bigint();
      });
      socket.once("connect", () => {
        connectStartAt = lookupStart ?? start;
        connectMs = Number(process.hrtime.bigint() - connectStartAt) / 1e6;
        tlsStart = process.hrtime.bigint();
      });
      socket.once("secureConnect", () => {
        if (tlsStart) tlsHandshakeMs = Number(process.hrtime.bigint() - tlsStart) / 1e6;
      });
    });

    req.on("timeout", () => req.destroy(new Error(`Crawl timed out after ${timeoutMs / 1000}s`)));
    req.on("error", reject);
    req.end();
  });
}

const ROBOTS_TIMEOUT_MS = 5000;

/** Real fetch+parse of /robots.txt — only the "User-agent: *" group (we
 * don't spoof a specific bot's UA, so per-bot groups don't apply to us).
 * Simple prefix matching on Disallow paths, which is how robots.txt matching
 * actually works for the common case. Never blocks the crawl itself — this
 * is the site owner auditing their own page, not a generic bot — just reports
 * what a generic crawler would see. */
async function checkRobotsTxt(origin: string, pagePath: string): Promise<{ exists: boolean; disallowsThisPage: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS);
  try {
    const res = await fetch(`${origin}/robots.txt`, { signal: controller.signal, headers: { "User-Agent": "OkaraAlternative/1.0" } });
    if (!res.ok) return { exists: false, disallowsThisPage: false };
    const text = await res.text();

    let inWildcardGroup = false;
    const disallowPaths: string[] = [];
    for (const rawLine of text.split("\n")) {
      const line = rawLine.split("#")[0].trim();
      if (!line) continue;
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") {
        inWildcardGroup = value === "*";
      } else if (key === "disallow" && inWildcardGroup && value) {
        disallowPaths.push(value);
      }
    }

    const disallowsThisPage = disallowPaths.some((p) => pagePath.startsWith(p));
    return { exists: true, disallowsThisPage };
  } catch {
    return { exists: false, disallowsThisPage: false };
  } finally {
    clearTimeout(timeout);
  }
}

export class SEOAgent {
  constructor(private pageSpeedApiKey?: string) {}

  async audit(url: string): Promise<SEOAuditPayload> {
    const issues: { label: string; level: "Warning" | "Error" }[] = [];

    const validated = assertPublicHttpUrl(url);

    // 1. Crawl URL — bounded by a timeout so a hung/slow target can't stall the
    // request forever. Uses the raw http(s) module (not fetch) so real
    // connection-phase timing is available for the Technical tab.
    let crawl: TimedFetchResult;
    try {
      crawl = await timedFetch(validated, CRAWL_TIMEOUT_MS);
      if (crawl.status < 200 || crawl.status >= 400) {
        throw new Error(`HTTP ${crawl.status}`);
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to crawl URL: ${detail}`);
    }
    const html = crawl.html;

    // Redirect-chain/loop — real signal from the hop-following already done
    // in timedFetch(). A single hop (http→https, apex↔www) is normal and not
    // worth flagging; 2+ hops or hitting the cap while still 3xx (a loop) is.
    if (crawl.redirectCount >= MAX_REDIRECTS && crawl.status >= 300 && crawl.status < 400) {
      issues.push({ label: `Redirect loop detected — didn't resolve after ${MAX_REDIRECTS} hops`, level: "Error" });
    } else if (crawl.redirectCount >= 2) {
      issues.push({ label: `Redirect chain detected (${crawl.redirectCount} hops before reaching the final page)`, level: "Warning" });
    }

    const robotsTxt = await checkRobotsTxt(validated.origin, validated.pathname);
    if (robotsTxt.disallowsThisPage) {
      issues.push({ label: "This page is disallowed by robots.txt for general crawlers", level: "Warning" });
    }

    const $ = cheerio.load(html);

    // Visible text only — strip script/style/noscript before extracting, so
    // downstream doc generation isn't fed JS bundles or CSS as "page content".
    $("script, style, noscript").remove();
    let bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 6000);
    let contentSource: "crawl" | "jina-fallback" = "crawl";

    // A plain crawl gets nothing but an empty shell on client-rendered SPAs
    // (confirmed for real: a React app's server HTML had 0 chars of body
    // text). Fall back to a real headless-browser render via Jina — no key
    // required — only when the plain crawl genuinely came back too thin.
    const MIN_BODY_TEXT_LENGTH = 200;
    let jinaFallback: Awaited<ReturnType<typeof jinaRead>> = null;
    if (bodyText.length < MIN_BODY_TEXT_LENGTH) {
      jinaFallback = await jinaRead(validated.toString());
      if (jinaFallback && jinaFallback.content.trim().length > bodyText.length) {
        bodyText = jinaFallback.content.trim().slice(0, 6000);
        contentSource = "jina-fallback";
      }
    }

    // 2. Parse tags
    const title = $("title").text() || "";
    const description = $("meta[name='description']").attr("content") || "";

    if (!title) issues.push({ label: "Missing Meta Title", level: "Error" });
    else if (title.length > 60) issues.push({ label: "Meta title too long (> 60 chars)", level: "Warning" });

    if (!description) issues.push({ label: "Missing Meta Description", level: "Error" });
    else if (description.length > 160) issues.push({ label: "Meta description too long (> 160 chars)", level: "Warning" });

    const headings = {
      h1: $("h1").length,
      h2: $("h2").length,
      h3: $("h3").length,
    };

    if (headings.h1 === 0) issues.push({ label: "No H1 tag found", level: "Error" });
    if (headings.h1 > 1) issues.push({ label: "Multiple H1 tags found", level: "Warning" });

    // Heading order — real DOM-order walk, flag the first level skip found
    // (e.g. h1 straight to h3 with no h2 between them). Cheerio returns
    // matches in document order, so this reflects the real page structure.
    let lastLevel = 0;
    $("h1, h2, h3, h4, h5, h6").each((_, el) => {
      const level = Number(el.tagName?.slice(1));
      if (lastLevel > 0 && level - lastLevel > 1) {
        issues.push({ label: `Heading order skips a level (h${lastLevel} → h${level})`, level: "Warning" });
        lastLevel = level;
        return false; // stop after the first skip — one flag is enough signal
      }
      lastLevel = level;
    });

    const openGraph: { key: string; value: string; ok: boolean }[] = [];
    $("meta[property^='og:']").each((_, el) => {
      const prop = $(el).attr("property");
      const content = $(el).attr("content");
      if (prop && content) openGraph.push({ key: prop, value: content, ok: true });
    });
    const missingOg = REQUIRED_OG_TAGS.filter((tag) => !openGraph.some((t) => t.key === tag));
    if (openGraph.length === 0) {
      issues.push({ label: "Missing Open Graph tags", level: "Warning" });
    } else if (missingOg.length > 0) {
      issues.push({ label: `Missing required OG tags: ${missingOg.join(", ")}`, level: "Warning" });
    }

    const twitter: { key: string; value: string; ok: boolean }[] = [];
    $("meta[name^='twitter:']").each((_, el) => {
      const name = $(el).attr("name");
      const content = $(el).attr("content");
      if (name && content) twitter.push({ key: name, value: content, ok: true });
    });
    const missingTwitter = REQUIRED_TWITTER_TAGS.filter((tag) => !twitter.some((t) => t.key === tag));
    if (missingTwitter.length > 0) {
      issues.push({ label: `Missing required Twitter card tags: ${missingTwitter.join(", ")}`, level: "Warning" });
    }

    // 3. PageSpeed — real call only if a key is configured. No mock fallback:
    // undefined here means "not available," and the frontend shows a real
    // crawl-derived substitute instead of ever inventing Lighthouse-shaped
    // numbers (a hardcoded 80/90/100/90 for every site is a lie dressed up
    // as data, even with a disclosure banner next to it).
    let pageSpeedScores: SEOAuditPayload["pageSpeed"];
    let vitals: SEOAuditPayload["coreWebVitals"];

    if (this.pageSpeedApiKey) {
      try {
        const result = await fetchPageSpeed(url, this.pageSpeedApiKey);
        pageSpeedScores = result.pageSpeed;
        vitals = result.coreWebVitals;
      } catch (e) {
        console.warn("Failed to fetch real PageSpeed Insights data.", e);
        issues.push({ label: "Failed to fetch PageSpeed Insights data — Performance/CWV not available this run", level: "Warning" });
      }
    }

    // 4. Design tokens — real signals only, from the same crawl, no second
    // fetch. Cheap (cheerio, no headless browser), so coverage is partial by
    // nature: reliable when the page uses Google Fonts / a theme-color meta
    // tag / an obviously-labeled logo image, silently absent otherwise.
    const resolveUrl = (raw: string | undefined): string | undefined => {
      if (!raw) return undefined;
      try {
        return new URL(raw, validated).toString();
      } catch {
        return undefined;
      }
    };

    const themeColor = $("meta[name='theme-color']").attr("content")?.trim() || undefined;

    const fonts = new Set<string>();
    $("link[href*='fonts.googleapis.com']").each((_, el) => {
      const href = $(el).attr("href");
      const fontUrl = resolveUrl(href);
      if (!fontUrl) return;
      try {
        for (const raw of new URL(fontUrl).searchParams.getAll("family")) {
          for (const entry of raw.split("|")) {
            const name = entry.split(":")[0].replace(/\+/g, " ").trim();
            if (name) fonts.add(name);
          }
        }
      } catch {
        // malformed font URL — skip
      }
    });

    let logoUrl: string | undefined;
    $("img").each((_, el) => {
      if (logoUrl) return;
      const alt = ($(el).attr("alt") || "").toLowerCase();
      const src = ($(el).attr("src") || "").toLowerCase();
      const cls = ($(el).attr("class") || "").toLowerCase();
      if (alt.includes("logo") || src.includes("logo") || cls.includes("logo")) {
        logoUrl = resolveUrl($(el).attr("src"));
      }
    });

    const faviconUrl = resolveUrl(
      $("link[rel='icon']").attr("href") || $("link[rel='shortcut icon']").attr("href")
    );

    // 5. Technical signals — real response headers/bytes + cheerio counts.
    const headerValue = (v: string | string[] | undefined): string | undefined =>
      Array.isArray(v) ? v[0] : v;

    const server = headerValue(crawl.headers.server);
    const encoding = headerValue(crawl.headers["content-encoding"]);
    const cacheControl = headerValue(crawl.headers["cache-control"]) || "";
    const cacheable = !!cacheControl && !/no-store|no-cache|private/i.test(cacheControl);
    const pageSizeBytes = Buffer.byteLength(html, "utf8");
    const domSize = $("*").length;

    // On-Page Score — a deterministic % of real checks passed, not a
    // Lighthouse-style number. Every check here mirrors something already
    // computed above (title/description length, single H1, OG/Twitter presence).
    const onPageChecks = [
      !!title && title.length <= 60,
      !!description && description.length <= 160,
      headings.h1 === 1,
      openGraph.length > 0 && missingOg.length === 0,
      twitter.length > 0 && missingTwitter.length === 0,
      cacheable,
    ];
    const onPageScore = Math.round((onPageChecks.filter(Boolean).length / onPageChecks.length) * 100);

    // 6. Render-blocking — scripts/stylesheets in <head> without async/defer/module.
    let blockingScripts = 0;
    $("head script").each((_, el) => {
      const type = ($(el).attr("type") || "").toLowerCase();
      if (!$(el).attr("async") && !$(el).attr("defer") && type !== "module") blockingScripts++;
    });
    let blockingStylesheets = 0;
    $("head link[rel='stylesheet']").each((_, el) => {
      const media = ($(el).attr("media") || "").toLowerCase();
      if (media !== "print") blockingStylesheets++;
    });

    // 7. Content relevance — deterministic keyword-overlap, not an LLM guess
    // that could vary run to run.
    const STOPWORDS = new Set([
      "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with",
      "your", "you", "is", "are", "it", "this", "that", "at", "by", "from",
      "as", "be", "was", "were", "will", "can", "our",
    ]);
    const tokenize = (text: string): string[] =>
      (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2 && !STOPWORDS.has(t));
    const bodyTokens = new Set(tokenize(bodyText));
    const relevanceOf = (text: string): number => {
      const tokens = tokenize(text);
      if (tokens.length === 0) return 0;
      const matched = tokens.filter((t) => bodyTokens.has(t)).length;
      return Math.round((matched / tokens.length) * 100);
    };
    const contentRelevance = {
      titleRelevance: relevanceOf(title),
      descriptionRelevance: relevanceOf(description),
      keywordRelevance: relevanceOf(`${title} ${description}`),
    };

    // 8. Links — capped, classified internal/external. No reachability check
    // here — that's a separate, explicit, bounded action (see
    // /api/agents/links/check) so a routine audit doesn't silently fire
    // dozens of extra requests.
    const links: { href: string; text: string; internal: boolean }[] = [];
    const seenHrefs = new Set<string>();
    $("a[href]").each((_, el) => {
      if (links.length >= 50) return;
      const resolved = resolveUrl($(el).attr("href"));
      if (!resolved || seenHrefs.has(resolved) || !resolved.startsWith("http")) return;
      seenHrefs.add(resolved);
      let internal = false;
      try {
        internal = new URL(resolved).hostname === validated.hostname;
      } catch {
        // unresolvable — treat as external
      }
      links.push({ href: resolved, text: $(el).text().trim().slice(0, 80), internal });
    });

    // Same SPA situation as bodyText — no server-rendered <a> tags to find.
    // Jina's rendered markdown has real internal links; use those instead of
    // reporting zero.
    if (links.length === 0 && jinaFallback) {
      for (const l of extractMarkdownLinks(jinaFallback.content, validated.hostname)) {
        if (links.length >= 50) break;
        links.push({ href: l.href, text: l.text.slice(0, 80), internal: true });
      }
    }

    return {
      url,
      meta: { title, description },
      headings,
      openGraph,
      twitter,
      issues,
      pageSpeed: pageSpeedScores,
      coreWebVitals: vitals,
      bodyText,
      contentSource,
      design: { themeColor, fonts: Array.from(fonts), logoUrl, faviconUrl },
      technical: { onPageScore, server, status: crawl.status, encoding, pageSizeBytes, domSize, cacheable, redirectCount: crawl.redirectCount, robotsTxt },
      serverTiming: crawl.timing,
      renderBlocking: { blockingScripts, blockingStylesheets },
      contentRelevance,
      links,
    };
  }
}
