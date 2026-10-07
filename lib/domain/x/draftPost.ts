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

/** Length as X counts it: links are 23, characters outside the BMP (emoji) are 2. */
export function countTweetChars(text: string): number {
  let count = 0;
  const withoutUrls = text.replace(URL_PATTERN, () => {
    count += URL_CHAR_COUNT;
    return "";
  });
  for (const ch of withoutUrls) count += (ch.codePointAt(0) ?? 0) > 0xffff ? 2 : 1;
  return count;
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
