import * as cheerio from "cheerio";
import { extractTitle } from "@/lib/domain/seo/extractTitle";
import { request as httpRequest, type IncomingHttpHeaders } from "http";
import { request as httpsRequest } from "https";
import { jinaRead, extractMarkdownLinks } from "@/lib/domain/shared/jinaReader";
import { fetchPageSpeed, type CwvSnapshot } from "@/lib/domain/seo/pageSpeedInsights";

export type { CwvStatus, CwvMetric, CwvSnapshot } from "@/lib/domain/seo/pageSpeedInsights";

/** Structured findings, additive to `issues` (which stays as-is for the
 * existing Issues list UI). Each carries a stable issueId (used as the
 * code_fixes memory key — same finding on a re-audit maps to the same row,
 * so the fix agent doesn't re-suggest something already PR'd) and an
 * autoFixable flag — true only for single-tag/single-line edits a small LLM
 * patch can make safely without touching rendered content structure. */
export type Finding = {
  issueId: string;
  category: "meta-title" | "meta-description" | "canonical" | "og-tags" | "twitter-tags" | "robots-txt" | "heading-structure";
  severity: "Warning" | "Error";
  label: string;
  evidence: Record<string, string | number | null>;
  autoFixable: boolean;
};

export type SEOAuditPayload = {
  url: string;
  meta: {
    title: string;
    description: string;
    canonical?: string;
    robots?: string;
    indexable: boolean;
  };
  headings: { h1: number; h2: number; h3: number };
  openGraph: { key: string; value: string; ok: boolean }[];
  twitter: { key: string; value: string; ok: boolean }[];
  issues: { label: string; level: "Warning" | "Error" }[];
  findings: Finding[];
  pageSpeed?: {
    desktop: { performance: number; accessibility: number; bestPractices: number; seo: number };
    mobile: { performance: number; accessibility: number; bestPractices: number; seo: number };
  };
  coreWebVitals?: { desktop: CwvSnapshot; mobile: CwvSnapshot };
  bodyText: string;
  contentSource: "crawl" | "jina-fallback";
  design: { themeColor?: string; fonts: string[]; logoUrl?: string; faviconUrl?: string };
  technical: {
    onPageScore: number;
    server?: string;
    status: number;
    encoding?: string;
    pageSizeBytes: number;
    domSize: number;
    cacheable: boolean;
    redirectCount: number;
    robotsTxt: { exists: boolean; disallowsThisPage: boolean };
  };
  serverTiming: { connectMs?: number; tlsHandshakeMs?: number; ttfbMs?: number; downloadMs?: number };
  renderBlocking: { blockingScripts: number; blockingStylesheets: number };
  contentRelevance: { titleRelevance: number; descriptionRelevance: number; keywordRelevance: number };
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
  try { parsed = new URL(raw); } catch { throw new Error("Invalid URL"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }
  const host = parsed.hostname.toLowerCase();
  const isPrivate =
    host === "localhost" || host === "0.0.0.0" || host.endsWith(".local") ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (isPrivate) throw new Error("URLs pointing to local/private addresses are not allowed");
  return parsed;
}

type FetchTiming = { connectMs?: number; tlsHandshakeMs?: number; ttfbMs?: number; downloadMs?: number };
type TimedFetchResult = { html: string; status: number; headers: IncomingHttpHeaders; timing: FetchTiming; redirectCount: number };
const MAX_REDIRECTS = 5;

async function timedFetch(
  url: URL,
  timeoutMs: number,
  redirectsLeft = MAX_REDIRECTS,
  hopsSoFar = 0,
  connectionTiming: Pick<FetchTiming, "connectMs" | "tlsHandshakeMs"> = {}
): Promise<TimedFetchResult> {
  const result = await timedFetchOnce(url, timeoutMs);
  const carriedConnectionTiming = {
    connectMs: result.timing.connectMs ?? connectionTiming.connectMs,
    tlsHandshakeMs: result.timing.tlsHandshakeMs ?? connectionTiming.tlsHandshakeMs,
  };
  const location = result.headers.location;
  if (result.status >= 300 && result.status < 400 && location && redirectsLeft > 0) {
    const nextUrl = new URL(location, url);
    assertPublicHttpUrl(nextUrl.toString());
    return timedFetch(nextUrl, timeoutMs, redirectsLeft - 1, hopsSoFar + 1, carriedConnectionTiming);
  }
  return { ...result, timing: { ...result.timing, ...carriedConnectionTiming }, redirectCount: hopsSoFar };
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
      { hostname: url.hostname, port: url.port || (isHttps ? 443 : 80), path: url.pathname + url.search,
        method: "GET", headers: { "User-Agent": "OkaraAlternative/1.0" }, timeout: timeoutMs },
      (res) => {
        const ttfbMs = Number(process.hrtime.bigint() - start) / 1e6;
        const chunks: Buffer[] = [];
        const downloadStart = process.hrtime.bigint();
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({
          html: Buffer.concat(chunks).toString("utf8"), status: res.statusCode ?? 0, headers: res.headers,
          timing: { connectMs, tlsHandshakeMs, ttfbMs, downloadMs: Number(process.hrtime.bigint() - downloadStart) / 1e6 },
          redirectCount: 0,
        }));
        res.on("error", reject);
      }
    );
    req.on("socket", (socket) => {
      socket.once("lookup", () => { lookupStart = process.hrtime.bigint(); });
      socket.once("connect", () => {
        connectStartAt = lookupStart ?? start;
        connectMs = Number(process.hrtime.bigint() - connectStartAt) / 1e6;
        tlsStart = process.hrtime.bigint();
      });
      socket.once("secureConnect", () => { if (tlsStart) tlsHandshakeMs = Number(process.hrtime.bigint() - tlsStart) / 1e6; });
    });
    req.on("timeout", () => req.destroy(new Error(`Crawl timed out after ${timeoutMs / 1000}s`)));
    req.on("error", reject);
    req.end();
  });
}

const ROBOTS_TIMEOUT_MS = 5000;

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
      if (key === "user-agent") inWildcardGroup = value === "*";
      else if (key === "disallow" && inWildcardGroup && value) disallowPaths.push(value);
    }
    return { exists: true, disallowsThisPage: disallowPaths.some((p) => pagePath.startsWith(p)) };
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
    const findings: Finding[] = [];
    const validated = assertPublicHttpUrl(url);
    let crawl: TimedFetchResult;
    try {
      crawl = await timedFetch(validated, CRAWL_TIMEOUT_MS);
      if (crawl.status < 200 || crawl.status >= 400) throw new Error(`HTTP ${crawl.status}`);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to crawl URL: ${detail}`);
    }
    const html = crawl.html;
    if (crawl.redirectCount >= MAX_REDIRECTS && crawl.status >= 300 && crawl.status < 400) {
      issues.push({ label: `Redirect loop detected — didn't resolve after ${MAX_REDIRECTS} hops`, level: "Error" });
    } else if (crawl.redirectCount >= 2) {
      issues.push({ label: `Redirect chain detected (${crawl.redirectCount} hops before reaching the final page)`, level: "Warning" });
    }

    const robotsTxt = await checkRobotsTxt(validated.origin, validated.pathname);
    if (robotsTxt.disallowsThisPage) {
      issues.push({ label: "This page is disallowed by robots.txt for general crawlers", level: "Warning" });
      findings.push({ issueId: "robots-txt-disallow", category: "robots-txt", severity: "Warning",
        label: "This page is disallowed by robots.txt for general crawlers", evidence: { path: validated.pathname }, autoFixable: true });
    }

    const $ = cheerio.load(html);
    $("script, style, noscript").remove();
    let bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 6000);
    let contentSource: "crawl" | "jina-fallback" = "crawl";
    const MIN_BODY_TEXT_LENGTH = 200;
    let jinaFallback: Awaited<ReturnType<typeof jinaRead>> = null;
    if (bodyText.length < MIN_BODY_TEXT_LENGTH) {
      jinaFallback = await jinaRead(validated.toString());
      if (jinaFallback && jinaFallback.content.trim().length > bodyText.length) {
        bodyText = jinaFallback.content.trim().slice(0, 6000);
        contentSource = "jina-fallback";
      }
    }

    const title = extractTitle($);
    const description = $("meta[name='description']").attr("content") || "";
    const canonical = $("link[rel='canonical']").attr("href")?.trim() || undefined;
    const robots = $("meta[name='robots']").attr("content")?.trim() || undefined;
    const indexable = !robots?.split(",").some((directive) => directive.trim().toLowerCase() === "noindex");

    if (!canonical) issues.push({ label: "Missing canonical URL", level: "Warning" });
    if (!indexable) issues.push({ label: "Page is marked noindex", level: "Warning" });
    if (!title) {
      issues.push({ label: "Missing Meta Title", level: "Error" });
      findings.push({ issueId: "meta-title-missing", category: "meta-title", severity: "Error", label: "Missing Meta Title", evidence: { current: null }, autoFixable: true });
    } else if (title.length > 60) {
      issues.push({ label: "Meta title too long (> 60 chars)", level: "Warning" });
      findings.push({ issueId: "meta-title-too-long", category: "meta-title", severity: "Warning", label: "Meta title too long (> 60 chars)", evidence: { current: title, length: title.length }, autoFixable: true });
    }

    if (!description) {
      issues.push({ label: "Missing Meta Description", level: "Error" });
      findings.push({ issueId: "meta-description-missing", category: "meta-description", severity: "Error", label: "Missing Meta Description", evidence: { current: null }, autoFixable: true });
    } else if (description.length > 160) {
      issues.push({ label: "Meta description too long (> 160 chars)", level: "Warning" });
      findings.push({ issueId: "meta-description-too-long", category: "meta-description", severity: "Warning", label: "Meta description too long (> 160 chars)", evidence: { current: description, length: description.length }, autoFixable: true });
    }

    if (!canonical) {
      issues.push({ label: "Missing canonical tag", level: "Warning" });
      findings.push({ issueId: "canonical-missing", category: "canonical", severity: "Warning", label: "Missing canonical tag",
        evidence: { current: null, url: validated.toString() }, autoFixable: true });
    }

    const headings = { h1: $("h1").length, h2: $("h2").length, h3: $("h3").length };
    if (headings.h1 === 0) {
      issues.push({ label: "No H1 tag found", level: "Error" });
      findings.push({ issueId: "heading-h1-missing", category: "heading-structure", severity: "Error", label: "No H1 tag found", evidence: { h1Count: 0 }, autoFixable: false });
    }
    if (headings.h1 > 1) {
      issues.push({ label: "Multiple H1 tags found", level: "Warning" });
      findings.push({ issueId: "heading-h1-multiple", category: "heading-structure", severity: "Warning", label: "Multiple H1 tags found", evidence: { h1Count: headings.h1 }, autoFixable: false });
    }

    let lastLevel = 0;
    $("h1, h2, h3, h4, h5, h6").each((_, el) => {
      const level = Number(el.tagName?.slice(1));
      if (lastLevel > 0 && level - lastLevel > 1) {
        issues.push({ label: `Heading order skips a level (h${lastLevel} → h${level})`, level: "Warning" });
        findings.push({ issueId: "heading-order-skip", category: "heading-structure", severity: "Warning",
          label: `Heading order skips a level (h${lastLevel} → h${level})`, evidence: { fromLevel: lastLevel, toLevel: level }, autoFixable: false });
        lastLevel = level;
        return false;
      }
      lastLevel = level;
    });

    const openGraph: { key: string; value: string; ok: boolean }[] = [];
    $("meta[property^='og:']").each((_, el) => {
      const prop = $(el).attr("property"); const content = $(el).attr("content");
      if (prop && content) openGraph.push({ key: prop, value: content, ok: true });
    });
    const missingOg = REQUIRED_OG_TAGS.filter((tag) => !openGraph.some((t) => t.key === tag));
    if (openGraph.length === 0) {
      issues.push({ label: "Missing Open Graph tags", level: "Warning" });
      findings.push({ issueId: "og-tags-missing", category: "og-tags", severity: "Warning", label: "Missing Open Graph tags", evidence: { missing: REQUIRED_OG_TAGS.join(", ") }, autoFixable: true });
    } else if (missingOg.length > 0) {
      issues.push({ label: `Missing required OG tags: ${missingOg.join(", ")}`, level: "Warning" });
      findings.push({ issueId: "og-tags-partial", category: "og-tags", severity: "Warning",
        label: `Missing required OG tags: ${missingOg.join(", ")}`, evidence: { missing: missingOg.join(", "), present: openGraph.map((t) => t.key).join(", ") }, autoFixable: true });
    }

    const twitter: { key: string; value: string; ok: boolean }[] = [];
    $("meta[name^='twitter:']").each((_, el) => {
      const name = $(el).attr("name"); const content = $(el).attr("content");
      if (name && content) twitter.push({ key: name, value: content, ok: true });
    });
    const missingTwitter = REQUIRED_TWITTER_TAGS.filter((tag) => !twitter.some((t) => t.key === tag));
    if (missingTwitter.length > 0) {
      issues.push({ label: `Missing required Twitter card tags: ${missingTwitter.join(", ")}`, level: "Warning" });
      findings.push({ issueId: "twitter-tags-missing", category: "twitter-tags", severity: "Warning",
        label: `Missing required Twitter card tags: ${missingTwitter.join(", ")}`, evidence: { missing: missingTwitter.join(", "), present: twitter.map((t) => t.key).join(", ") }, autoFixable: true });
    }

    let pageSpeedScores: SEOAuditPayload["pageSpeed"];
    let vitals: SEOAuditPayload["coreWebVitals"];
    if (this.pageSpeedApiKey) {
      try {
        const result = await fetchPageSpeed(url, this.pageSpeedApiKey);
        pageSpeedScores = result.pageSpeed; vitals = result.coreWebVitals;
      } catch (e) {
        console.warn("Failed to fetch real PageSpeed Insights data.", e);
        issues.push({ label: "Failed to fetch PageSpeed Insights data — Performance/CWV not available this run", level: "Warning" });
      }
    }

    const resolveUrl = (raw: string | undefined): string | undefined => {
      if (!raw) return undefined;
      try { return new URL(raw, validated).toString(); } catch { return undefined; }
    };
    const themeColor = $("meta[name='theme-color']").attr("content")?.trim() || undefined;
    const fonts = new Set<string>();
    $("link[href*='fonts.googleapis.com']").each((_, el) => {
      const href = $(el).attr("href"); const fontUrl = resolveUrl(href);
      if (!fontUrl) return;
      try {
        for (const raw of new URL(fontUrl).searchParams.getAll("family")) {
          for (const entry of raw.split("|")) {
            const name = entry.split(":")[0].replace(/\+/g, " ").trim();
            if (name) fonts.add(name);
          }
        }
      } catch {}
    });

    let logoUrl: string | undefined;
    $("img").each((_, el) => {
      if (logoUrl) return;
      const alt = ($(el).attr("alt") || "").toLowerCase();
      const src = ($(el).attr("src") || "").toLowerCase();
      const cls = ($(el).attr("class") || "").toLowerCase();
      if (alt.includes("logo") || src.includes("logo") || cls.includes("logo")) logoUrl = resolveUrl($(el).attr("src"));
    });
    const faviconUrl = resolveUrl($("link[rel='icon']").attr("href") || $("link[rel='shortcut icon']").attr("href"));

    const headerValue = (v: string | string[] | undefined): string | undefined => Array.isArray(v) ? v[0] : v;
    const server = headerValue(crawl.headers.server);
    const encoding = headerValue(crawl.headers["content-encoding"]);
    const cacheControl = headerValue(crawl.headers["cache-control"]) || "";
    const cacheable = !!cacheControl && !/no-store|no-cache|private/i.test(cacheControl);
    const pageSizeBytes = Buffer.byteLength(html, "utf8");
    const domSize = $("*").length;

    const onPageChecks = [
      !!title && title.length <= 60,
      !!description && description.length <= 160,
      headings.h1 === 1,
      openGraph.length > 0 && missingOg.length === 0,
      twitter.length > 0 && missingTwitter.length === 0,
      cacheable,
    ];
    const onPageScore = Math.round((onPageChecks.filter(Boolean).length / onPageChecks.length) * 100);

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

    const STOPWORDS = new Set([
      "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with",
      "your", "you", "is", "are", "it", "this", "that", "at", "by", "from",
      "as", "be", "was", "were", "will", "can", "our",
    ]);
    const tokenize = (text: string): string[] => (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 2 && !STOPWORDS.has(t));
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

    const links: { href: string; text: string; internal: boolean }[] = [];
    const seenHrefs = new Set<string>();
    $("a[href]").each((_, el) => {
      if (links.length >= 50) return;
      const resolved = resolveUrl($(el).attr("href"));
      if (!resolved || seenHrefs.has(resolved) || !resolved.startsWith("http")) return;
      seenHrefs.add(resolved);
      let internal = false;
      try { internal = new URL(resolved).hostname === validated.hostname; } catch {}
      links.push({ href: resolved, text: $(el).text().trim().slice(0, 80), internal });
    });
    if (links.length === 0 && jinaFallback) {
      for (const l of extractMarkdownLinks(jinaFallback.content, validated.hostname)) {
        if (links.length >= 50) break;
        links.push({ href: l.href, text: l.text.slice(0, 80), internal: true });
      }
    }

    return {
      url, meta: { title, description, canonical, robots, indexable }, headings, openGraph, twitter,
      issues, findings, pageSpeed: pageSpeedScores, coreWebVitals: vitals, bodyText, contentSource,
      design: { themeColor, fonts: Array.from(fonts), logoUrl, faviconUrl },
      technical: { onPageScore, server, status: crawl.status, encoding, pageSizeBytes, domSize, cacheable, redirectCount: crawl.redirectCount, robotsTxt },
      serverTiming: crawl.timing, renderBlocking: { blockingScripts, blockingStylesheets }, contentRelevance, links,
    };
  }
}
