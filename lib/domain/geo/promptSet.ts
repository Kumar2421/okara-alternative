import { MAX_TRACKED_PROMPTS, type GeoPrompt } from "./types.ts";

export type GscQuery = { query: string; impressions: number; clicks?: number };

const QUESTION_START = /^(how|what|why|when|which|who|can|does|do|is|are|should)\b/i;

export function normalizePrompt(prompt: string): string {
  return prompt.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

/** Turn a search phrase into a question a buyer would ask an AI assistant. */
export function queryToPrompt(query: string): string {
  const q = query.trim().replace(/\s+/g, " ").replace(/[?.!]+$/, "");
  if (/\balternatives?\b/i.test(q)) return `What are the best ${q.replace(/^best\s+/i, "")}?`;
  if (/\b(vs|versus)\b/i.test(q)) return `Which is better: ${q.replace(/\bversus\b/i, "vs")}?`;
  if (/^(best|top)\b/i.test(q)) return `What are the ${q}?`;
  if (QUESTION_START.test(q)) return `${q.charAt(0).toUpperCase()}${q.slice(1)}?`;
  return `What is the best tool for ${q}?`;
}

function isBranded(query: string, brandTerms: string[]): boolean {
  const n = normalizePrompt(query);
  return brandTerms.some((t) => t.length > 2 && n.includes(normalizePrompt(t)));
}

/**
 * Suggest prompts from top Search Console queries. Branded queries are skipped
 * (people who already know you tell you nothing about discovery). Deduped.
 */
export function suggestPrompts(queries: GscQuery[], brandTerms: string[], max = MAX_TRACKED_PROMPTS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const sorted = [...queries].sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query));
  for (const q of sorted) {
    if (out.length >= max) break;
    if (q.query.trim().split(/\s+/).length < 2) continue;
    if (isBranded(q.query, brandTerms)) continue;
    const prompt = queryToPrompt(q.query);
    const key = normalizePrompt(prompt);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(prompt);
  }
  return out;
}

/**
 * Merge the user's saved prompts with fresh suggestions. Manual prompts come
 * first, existing ones keep their active flag, new suggestions only fill
 * remaining room. Never more than `max` active.
 */
export function mergePrompts(existing: GeoPrompt[], suggestions: string[], max = MAX_TRACKED_PROMPTS): GeoPrompt[] {
  const seen = new Set<string>();
  const merged: GeoPrompt[] = [];
  const add = (p: GeoPrompt) => {
    const key = normalizePrompt(p.prompt);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(p);
  };
  for (const p of existing.filter((p) => p.source === "manual")) add(p);
  for (const p of existing.filter((p) => p.source === "gsc")) add(p);
  for (const s of suggestions) {
    if (merged.filter((p) => p.active).length >= max) break;
    add({ prompt: s, source: "gsc", active: true });
  }
  let active = 0;
  return merged.map((p) => {
    if (!p.active) return p;
    active += 1;
    return active > max ? { ...p, active: false } : p;
  });
}

export function activePrompts(prompts: GeoPrompt[], max = MAX_TRACKED_PROMPTS): string[] {
  return prompts.filter((p) => p.active).slice(0, max).map((p) => p.prompt);
}
