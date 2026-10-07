/**
 * Per-project Reddit agent settings: priority subreddits, search keywords and
 * country. Stored as a `reddit_settings` project document (JSON), so no
 * schema change is needed in either mode.
 */

export const REDDIT_COUNTRIES = ["global", "us"] as const;
export type RedditCountry = (typeof REDDIT_COUNTRIES)[number];

export type RedditSettings = {
  version: 1;
  /** Normalized "r/name" entries. */
  subreddits: string[];
  keywords: string[];
  country: RedditCountry;
};

export const REDDIT_LIMITS = { subreddits: 20, keywords: 30, keywordLength: 60 } as const;

export function emptyRedditSettings(): RedditSettings {
  return { version: 1, subreddits: [], keywords: [], country: "global" };
}

/** "r/Foo", "/r/foo", "https://reddit.com/r/foo/" or "foo" become "r/foo"; null when not a valid subreddit name (2-21 chars: letters, digits, underscore). */
export function normalizeSubreddit(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim();
  s = s.replace(/^https?:\/\/(www\.|old\.)?reddit\.com/i, "").replace(/^\/+/, "");
  s = s.replace(/^r\//i, "").replace(/\/.*$/, "");
  if (!/^[A-Za-z0-9_]{2,21}$/.test(s)) return null;
  return `r/${s}`;
}

export function normalizeKeyword(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.replace(/\s+/g, " ").trim().slice(0, REDDIT_LIMITS.keywordLength);
  return s ? s : null;
}

function cleanList(value: unknown, max: number, norm: (v: unknown) => string | null): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = norm(item);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** Sanitize anything from the client or storage into valid settings. Never throws. */
export function normalizeRedditSettings(input: unknown): RedditSettings {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    version: 1,
    subreddits: cleanList(o.subreddits, REDDIT_LIMITS.subreddits, normalizeSubreddit),
    keywords: cleanList(o.keywords, REDDIT_LIMITS.keywords, normalizeKeyword),
    country: o.country === "us" ? "us" : "global",
  };
}

export type AddResult = { ok: true; list: string[] } | { ok: false; error: string };

function addTo(list: string[], value: string | null, max: number, label: string, invalid: string): AddResult {
  if (!value) return { ok: false, error: invalid };
  if (list.some((x) => x.toLowerCase() === value.toLowerCase())) return { ok: false, error: `${value} is already added.` };
  if (list.length >= max) return { ok: false, error: `You can add up to ${max} ${label}.` };
  return { ok: true, list: [...list, value] };
}

export function addSubreddit(list: string[], raw: string): AddResult {
  return addTo(list, normalizeSubreddit(raw), REDDIT_LIMITS.subreddits, "subreddits", "Enter a valid subreddit name, like r/startups.");
}

export function addKeyword(list: string[], raw: string): AddResult {
  return addTo(list, normalizeKeyword(raw), REDDIT_LIMITS.keywords, "keywords", "Enter a keyword.");
}

export type RedditSearchPlan = {
  /** Web-search queries; empty when the project has no saved focus (current behaviour). */
  queries: string[];
  /** Search country code to pass to the search provider, or null for no filter. */
  country: "us" | null;
};

const MAX_QUERIES = 12;
const KEYWORDS_PER_QUERY = 3;

/** Build search queries from saved settings. Pure; no I/O. */
export function buildRedditSearchPlan(settings: RedditSettings): RedditSearchPlan {
  const country = settings.country === "us" ? "us" : null;
  const keywords = settings.keywords.map((k) => (/\s/.test(k) ? `"${k}"` : k));
  const terms = keywords.slice(0, KEYWORDS_PER_QUERY).join(" OR ");
  const queries: string[] = [];

  if (settings.subreddits.length > 0) {
    for (const sub of settings.subreddits) {
      queries.push(`site:reddit.com/${sub}${terms ? ` ${terms}` : ""}`);
      if (queries.length >= MAX_QUERIES) break;
    }
  } else if (keywords.length > 0) {
    for (let i = 0; i < keywords.length && queries.length < MAX_QUERIES; i += KEYWORDS_PER_QUERY) {
      queries.push(`site:reddit.com ${keywords.slice(i, i + KEYWORDS_PER_QUERY).join(" OR ")}`);
    }
  }
  return { queries, country };
}

/** Subreddits for a run: request-supplied first, then saved priorities, deduped, as bare names without "r/". */
export function mergeSubreddits(requested: string[], saved: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...requested, ...saved]) {
    const n = normalizeSubreddit(raw);
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n.slice(2));
  }
  return out;
}
