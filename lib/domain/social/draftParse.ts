/**
 * Parse and validate model-generated LinkedIn and Reddit drafts.
 * Mirrors xDraftPost.ts logic: extract JSON, validate fields, drop invalid ones.
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type LinkedInDraft = {
  hookLine: string;
  body: string;
};

export type RedditDraft = {
  subreddit: string;
  title: string;
  body: string;
};

// LinkedIn limits: hook + body between 100-3000 chars total
const MIN_LINKEDIN_CHARS = 100;
const MAX_LINKEDIN_CHARS = 3000;

// Reddit limits
const MAX_REDDIT_TITLE = 300;
const MAX_REDDIT_BODY = 40000;
const MIN_REDDIT_TITLE = 1;
const MIN_REDDIT_BODY = 1;

/**
 * Validate a LinkedIn draft object from the model.
 * hookLine and body must together be 100-3000 chars.
 */
export function parseLinkedInDraft(value: unknown): ParseResult<LinkedInDraft> {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Draft is not an object." };
  }

  const v = value as Record<string, unknown>;
  const hookLine = typeof v.hookLine === "string" ? v.hookLine.replace(/\r\n/g, "\n").trim() : "";
  const body = typeof v.body === "string" ? v.body.replace(/\r\n/g, "\n").trim() : "";

  if (!hookLine || !body) {
    return { ok: false, error: "Draft hookLine and body are required." };
  }

  const totalChars = hookLine.length + body.length;
  if (totalChars < MIN_LINKEDIN_CHARS) {
    return { ok: false, error: `Draft is ${totalChars} characters, under the ${MIN_LINKEDIN_CHARS} character minimum.` };
  }
  if (totalChars > MAX_LINKEDIN_CHARS) {
    return { ok: false, error: `Draft is ${totalChars} characters, over the ${MAX_LINKEDIN_CHARS} character limit.` };
  }

  return { ok: true, value: { hookLine, body } };
}

/**
 * Validate a Reddit draft object from the model.
 * Must include subreddit (validated format), title (1-300 chars), and body (1-40000 chars).
 */
export function parseRedditDraft(value: unknown): ParseResult<RedditDraft> {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "Draft is not an object." };
  }

  const v = value as Record<string, unknown>;
  const subreddit = typeof v.subreddit === "string" ? v.subreddit.trim() : "";
  const title = typeof v.title === "string" ? v.title.replace(/\r\n/g, "\n").trim() : "";
  const body = typeof v.body === "string" ? v.body.replace(/\r\n/g, "\n").trim() : "";

  if (!subreddit || !title || !body) {
    return { ok: false, error: "Draft subreddit, title, and body are required." };
  }

  // Validate subreddit format: 2-21 chars, alphanumeric and underscore only
  if (!/^[A-Za-z0-9_]{2,21}$/.test(subreddit)) {
    return { ok: false, error: `Invalid subreddit name: '${subreddit}'. Use 2-21 alphanumeric characters and underscores.` };
  }

  if (title.length < MIN_REDDIT_TITLE) {
    return { ok: false, error: "Draft title is empty." };
  }
  if (title.length > MAX_REDDIT_TITLE) {
    return { ok: false, error: `Draft title is ${title.length} characters, over the ${MAX_REDDIT_TITLE} character limit.` };
  }

  if (body.length < MIN_REDDIT_BODY) {
    return { ok: false, error: "Draft body is empty." };
  }
  if (body.length > MAX_REDDIT_BODY) {
    return { ok: false, error: `Draft body is ${body.length} characters, over the ${MAX_REDDIT_BODY} character limit.` };
  }

  return { ok: true, value: { subreddit, title, body } };
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[{[]/);
    const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Parse a whole model reply for LinkedIn drafts. Bad drafts are dropped and reported, never thrown.
 */
export function parseLinkedInBatch(raw: string, max = 3): { drafts: LinkedInDraft[]; errors: string[] } {
  const json = extractJson(raw);
  if (json === null) {
    return { drafts: [], errors: ["Reply was not valid JSON."] };
  }

  const list = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as { drafts?: unknown }).drafts)
      ? (json as { drafts: unknown[] }).drafts
      : json && typeof json === "object" && ("hookLine" in json || "body" in json)
        ? [json]
        : [];

  const drafts: LinkedInDraft[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    const parsed = parseLinkedInDraft(item);
    if (!parsed.ok) {
      errors.push(parsed.error);
      continue;
    }

    const key = `${parsed.value.hookLine}|${parsed.value.body}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (drafts.length < max) {
      drafts.push(parsed.value);
    }
  }

  if (list.length === 0) {
    errors.push("Reply had no drafts.");
  }

  return { drafts, errors };
}

/**
 * Parse a whole model reply for Reddit drafts. Bad drafts are dropped and reported, never thrown.
 */
export function parseRedditBatch(raw: string, max = 3): { drafts: RedditDraft[]; errors: string[] } {
  const json = extractJson(raw);
  if (json === null) {
    return { drafts: [], errors: ["Reply was not valid JSON."] };
  }

  const list = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as { drafts?: unknown }).drafts)
      ? (json as { drafts: unknown[] }).drafts
      : json && typeof json === "object" && ("subreddit" in json || "title" in json || "body" in json)
        ? [json]
        : [];

  const drafts: RedditDraft[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    const parsed = parseRedditDraft(item);
    if (!parsed.ok) {
      errors.push(parsed.error);
      continue;
    }

    const key = `${parsed.value.subreddit}|${parsed.value.title}|${parsed.value.body}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (drafts.length < max) {
      drafts.push(parsed.value);
    }
  }

  if (list.length === 0) {
    errors.push("Reply had no drafts.");
  }

  return { drafts, errors };
}
