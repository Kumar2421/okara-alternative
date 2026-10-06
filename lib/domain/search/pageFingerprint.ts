import * as cheerio from "cheerio";
import { extractTitle } from "../seo/extractTitle.ts";

/**
 * The parts of a page that search-opportunity fixes usually edit. Comparing
 * them before and after a change gives proof the change went live, without
 * needing access to the user's repo or CMS. A merged GitHub PR will later
 * supply the same proof from its diff.
 */
export type PageFingerprint = { title: string; description: string; h1: string };

export type FingerprintChange = {
  changed: boolean;
  changes: Array<{ field: keyof PageFingerprint; before: string; after: string }>;
};

const clean = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

export function parseFingerprint(html: string): PageFingerprint {
  const $ = cheerio.load(html);
  return {
    title: clean(extractTitle($)),
    description: clean($('meta[name="description" i]').first().attr("content")),
    h1: clean($("h1").first().text()),
  };
}

export function compareFingerprints(before: PageFingerprint | null | undefined, after: PageFingerprint | null | undefined): FingerprintChange | null {
  if (!before || !after) return null;
  const fields: Array<keyof PageFingerprint> = ["title", "description", "h1"];
  const changes = fields
    .filter((field) => before[field] !== after[field])
    .map((field) => ({ field, before: before[field], after: after[field] }));
  return { changed: changes.length > 0, changes };
}

/** Reject anything that is not an ordinary public web page (the URL came from our own data, this is defence in depth). */
export function isPublicHttpUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return false;
  if (host === "::1" || host.startsWith("[")) return false;
  return host.includes(".");
}

const MAX_CHARS = 300_000;

/** Best-effort fetch of a page's fingerprint; null on any failure. Never throws. */
export async function fetchPageFingerprint(url: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8000): Promise<PageFingerprint | null> {
  if (!isPublicHttpUrl(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers: { "User-Agent": "MarloBot/1.0 (+change check)" }, redirect: "follow" });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, MAX_CHARS);
    return parseFingerprint(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
