import type { SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";

/**
 * Best-effort reuse of the public /audit crawl result during onboarding's
 * first authenticated audit, so a brand-new project doesn't re-crawl a URL
 * seconds after the public audit already crawled it.
 *
 * In-memory + per-instance, same tradeoff the route's own rate limiter
 * already accepts: a miss just falls back to a full crawl, so a cold start
 * or a different serverless instance degrades to today's behavior, never to
 * a wrong one.
 */

const TTL_MS = 10 * 60 * 1000;
const entries = new Map<string, { payload: SEOAuditPayload; expiresAt: number }>();

function normalizeKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

export function setCachedPublicAudit(url: string, payload: SEOAuditPayload): void {
  const key = normalizeKey(url);
  entries.set(key, { payload, expiresAt: Date.now() + TTL_MS });
}

/**
 * Consumes (removes) the cache entry on hit — it's meant for exactly one
 * onboarding handoff, not repeat reuse across later re-audits.
 */
export function takeCachedPublicAudit(url: string): SEOAuditPayload | null {
  const key = normalizeKey(url);
  const hit = entries.get(key);
  if (!hit) return null;
  entries.delete(key);
  if (hit.expiresAt <= Date.now()) return null;
  return hit.payload;
}
