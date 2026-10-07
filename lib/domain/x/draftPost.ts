/**
 * Pure core of the X Writer: build the prompt, parse and validate what the
 * model sends back, count characters the way X does, and build the compose
 * link. No I/O here, so it is all unit-testable.
 */

export const MAX_TWEET_CHARS = 280;
/** X counts every link as 23 characters, whatever its real length. */
export const URL_CHAR_COUNT = 23;
export const MAX_VARIANTS = 3;
const MAX_ANGLE_CHARS = 40;
const MAX_WHY_CHARS = 280;
const MAX_DOC_CHARS = 2500;

export type PostDraft = {
  text: string;
  whyThisWorks: string;
  angle: string;
};

export type DraftInput = {
  name: string;
  description?: string;
  category?: string;
  /** Product Information document (markdown), if generated. */
  productInfo?: string;
  /** Marketing Strategy document (markdown): audience and positioning. */
  marketingStrategy?: string;
  /** Short, already-verified statements such as measured fix outcomes. Only these may be cited as results. */
  wins?: string[];
  /** 1 to 3 different angles. */
  variants?: number;
};

export type PostPublisher = {
  /** Reserved for the future OAuth posting PR; drafts never auto-post today. */
  publish(text: string): Promise<{ url: string }>;
};

const URL_PATTERN = /https?:\/\/[^\s]+/g;
/** Bare domains such as marlo.ai or example.com/path; X turns these into links too. */
const TLDS = "com|net|org|io|ai|co|app|dev|xyz|me|so|sh|gg|ly|to|tv|fm|cc|us|uk|de|fr|nl|ca|au|in|info|biz|tech|cloud|site|online|store|page|link|club|pro|inc|ing|run|new";
const BARE_DOMAIN_PATTERN = new RegExp(
  String.raw`(?<![\w@#./-])(?:[a-z0-9-]+\.)+(?:${TLDS})(?![\w-])(?::\d+)?(?:/[^\s]*)?`,
  "gi"
);

/** twitter-text weights: ranges 0-4351, 8192-8205, 8208-8223 and 8242-8247 count 1; everything else counts 2. */
function codePointWeight(cp: number): number {
  if (cp <= 0x10ff) return 1;
  if (cp >= 0x2000 && cp <= 0x200d) return 1;
  if (cp >= 0x2010 && cp <= 0x201f) return 1;
  if (cp >= 0x2032 && cp <= 0x2037) return 1;
  return 2;
}

/**
 * Length as X counts it: links (with or without a scheme) are 23, code points
 * above U+10FF are 2, and a ZWJ emoji sequence is one 2-weight glyph.
 */
export function countTweetChars(text: string): number {
  let count = 0;
  const strip = () => {
    count += URL_CHAR_COUNT;
    return " ";
  };
  const withoutUrls = text.replace(URL_PATTERN, strip).replace(BARE_DOMAIN_PATTERN, strip);
  // Each replaced link left one placeholder space behind; it is not real text.
  count -= (withoutUrls.match(/ /g) ?? []).length - (text.replace(URL_PATTERN, "").replace(BARE_DOMAIN_PATTERN, "").match(/ /g) ?? []).length;
  const cps = Array.from(withoutUrls);
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i].codePointAt(0) ?? 0;
    count += codePointWeight(cp);
    // Variation selectors and skin tones attach to the previous glyph; a ZWJ joins the next glyph into one emoji.
    if (cp === 0x200d && i + 1 < cps.length) {
      const next = cps[i + 1].codePointAt(0) ?? 0;
      if (next > 0x2000) {
        count -= 1; // the ZWJ itself is free inside a sequence
        count -= codePointWeight(next);
        i++;
        while (i + 1 < cps.length && isEmojiModifier(cps[i + 1].codePointAt(0) ?? 0)) i++;
      }
    }
  }
  return count;
}

function isEmojiModifier(cp: number): boolean {
  return cp === 0xfe0f || cp === 0xfe0e || (cp >= 0x1f3fb && cp <= 0x1f3ff);
}

export function isWithinLimit(text: string): boolean {
  return countTweetChars(text) <= MAX_TWEET_CHARS;
}

/** The X compose page prefilled with the draft. The user posts it themselves. */
export function intentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export function clampVariants(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return MAX_VARIANTS;
  return Math.min(MAX_VARIANTS, Math.max(1, Math.floor(n)));
}

function clip(value: string | undefined, max: number): string {
  const v = (value ?? "").trim();
  return v.length > max ? `${v.slice(0, max)}…` : v;
}

export function buildDraftPrompt(input: DraftInput): { system: string; prompt: string } {
  const variants = clampVariants(input.variants);
  const wins = (input.wins ?? []).map((w) => w.trim()).filter(Boolean).slice(0, 5);

  const system = `You write X (Twitter) posts for one specific product, in the founder's voice. You only know what the context below says.

Rules:
- Each post is ${MAX_TWEET_CHARS} characters or fewer. Count carefully.
- Short lines with line breaks, plain words, one idea per post. No walls of text.
- No hashtag spam: at most one hashtag, and only if it is natural. No emoji strings.
- Never invent metrics, numbers, customers, quotes, awards or results. Only cite a result if it appears under "Verified results". If there is none, write about the problem, the insight or what the product does.
- No unverifiable claims ("best", "#1", "guaranteed").
- Each of the ${variants} posts must take a clearly different angle (for example: problem, insight, behind the scenes, how it works).
- "whyThisWorks" is one short sentence (under 160 characters) explaining why the post should land.

Reply with JSON only, no prose, no code fence: {"drafts":[{"angle":"...","text":"...","whyThisWorks":"..."}]}`;

  const parts = [
    `Product: ${input.name}`,
    input.category ? `Category: ${input.category}` : "",
    input.description ? `Description: ${clip(input.description, 600)}` : "",
    input.productInfo ? `Product information:\n${clip(input.productInfo, MAX_DOC_CHARS)}` : "",
    input.marketingStrategy ? `Audience and positioning:\n${clip(input.marketingStrategy, MAX_DOC_CHARS)}` : "",
    wins.length ? `Verified results:\n${wins.map((w) => `- ${w}`).join("\n")}` : "Verified results: none",
  ].filter(Boolean);

  const prompt = `${parts.join("\n\n")}\n\nWrite ${variants} post${variants === 1 ? "" : "s"} for ${input.name}.`;
  return { system, prompt };
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validate one model-produced draft object. */
export function parseDraft(value: unknown): ParseResult<PostDraft> {
  if (!value || typeof value !== "object") return { ok: false, error: "Draft is not an object." };
  const v = value as Record<string, unknown>;
  const text = typeof v.text === "string" ? v.text.replace(/\r\n/g, "\n").trim() : "";
  if (!text) return { ok: false, error: "Draft text is empty." };
  if (!isWithinLimit(text)) return { ok: false, error: `Draft is ${countTweetChars(text)} characters, over the ${MAX_TWEET_CHARS} limit.` };
  const whyThisWorks = typeof v.whyThisWorks === "string" ? clip(v.whyThisWorks, MAX_WHY_CHARS) : "";
  const angle = typeof v.angle === "string" && v.angle.trim() ? clip(v.angle, MAX_ANGLE_CHARS) : "General";
  return { ok: true, value: { text, whyThisWorks, angle } };
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

/** Parse a whole model reply. Bad drafts are dropped and reported, never thrown. */
export function parseDraftBatch(raw: string, max = MAX_VARIANTS): { drafts: PostDraft[]; errors: string[] } {
  const json = extractJson(raw);
  if (json === null) return { drafts: [], errors: ["Reply was not valid JSON."] };
  const list = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as { drafts?: unknown }).drafts)
      ? (json as { drafts: unknown[] }).drafts
      : json && typeof json === "object" && "text" in json
        ? [json]
        : [];
  const drafts: PostDraft[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const parsed = parseDraft(item);
    if (!parsed.ok) {
      errors.push(parsed.error);
      continue;
    }
    if (seen.has(parsed.value.text)) continue;
    seen.add(parsed.value.text);
    if (drafts.length < max) drafts.push(parsed.value);
  }
  if (list.length === 0) errors.push("Reply had no drafts.");
  return { drafts, errors };
}
