import type { LlmDriver } from "@/lib/llm";
import { buildWebSearchTool } from "@/lib/domain/shared/webSearchTool";

export type CompetitorDiscoveryRequest = {
  projectName: string;
  url: string;
  bodyText: string;
  metaTitle: string;
  metaDescription: string;
  productInfo?: string;
  marketingStrategy?: string;
  model: string;
  /** When set (and the active provider supports tools — see
   * providerSupportsTools), the model searches the live web to find real
   * competitors. When absent, it falls back to naming known competitors from
   * its own training knowledge, grounded only in the crawled site context —
   * every name it gives still gets verified by a real fetch before being
   * saved, so a wrong guess just gets dropped rather than saved as fact. */
  tavilyApiKey?: string;
};

export type DiscoveredCandidate = { domain: string; reason: string };

const MAX_CANDIDATES = 5;

function ownHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Small local models routinely wrap JSON in ```json fences or add a
 * sentence before/after it — same class of quirk as the angle-bracket
 * templating bug found earlier this session. Extract the first [...] block
 * rather than trusting the whole response to be valid JSON on its own. */
function parseCandidates(raw: string, ownDomain: string): DiscoveredCandidate[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const out: DiscoveredCandidate[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const rawDomain = (item as Record<string, unknown>).domain;
    const rawReason = (item as Record<string, unknown>).reason;
    if (typeof rawDomain !== "string") continue;

    const domain = rawDomain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/.*$/, "");
    if (!domain || !domain.includes(".") || domain === ownDomain || seen.has(domain)) continue;

    seen.add(domain);
    out.push({ domain, reason: typeof rawReason === "string" ? rawReason : "" });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/**
 * Proposes real-world competitors for a project — the LLM half of
 * "automatic" competitor discovery (see refimages/Screenshot 2026-08-31
 * 125026.png, which shows the Competitors section pre-populated with no
 * manual-entry UI visible). Every domain this returns is a *candidate* only
 * — the caller must still verify each one resolves (fetchCompetitorSnippet)
 * before saving it, since neither mode here is search-grounded enough on its
 * own to trust blindly, especially the no-Tavily fallback.
 */
export class CompetitorDiscoveryAgent {
  constructor(private driver: LlmDriver, private apiKey: string, private baseUrl?: string) {}

  async discover(req: CompetitorDiscoveryRequest): Promise<{ candidates: DiscoveredCandidate[]; usedWebSearch: boolean }> {
    const hasWebSearch = !!req.tavilyApiKey;

    const system = `You are a senior competitive-intelligence analyst. Given a product's site data,
name up to ${MAX_CANDIDATES} real, currently-operating companies that genuinely compete with it —
not generic platforms unless they have a feature that directly overlaps.

${
  hasWebSearch
    ? `Use the web_search tool (queries like "<category> alternatives to <product>", "best <category> tools", "<product> vs") to find real competitors — don't rely on memory alone when you can confirm one.`
    : `You don't have web access this time. Name only companies you're confident actually exist from your own knowledge — every domain you give will be independently verified by fetching its website before it's shown to anyone, so a wrong or outdated guess just gets silently dropped. Don't pad the list to reach ${MAX_CANDIDATES} if you're not confident.`
}

Respond with ONLY a JSON array, no markdown code fences, no prose before or
after it, in exactly this shape:
[{"domain": "example.com", "reason": "one short sentence"}]`;

    const prompt = `Product: ${req.projectName} (${req.url})
Meta title: ${req.metaTitle || "(none found)"}
Meta description: ${req.metaDescription || "(none found)"}
Crawled page text (truncated): """${req.bodyText.slice(0, 2000) || "(none extracted)"}"""
${req.productInfo ? `\nProduct Information document:\n"""\n${req.productInfo.slice(0, 1500)}\n"""\n` : ""}${
      req.marketingStrategy ? `\nMarketing Strategy document (ICP, positioning):\n"""\n${req.marketingStrategy.slice(0, 1500)}\n"""\n` : ""
    }`;

    const result = await this.driver({
      apiKey: this.apiKey,
      model: req.model,
      system,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      baseUrl: this.baseUrl,
      tools: hasWebSearch ? [buildWebSearchTool(req.tavilyApiKey!)] : undefined,
    });

    const candidates = parseCandidates(result.text ?? "", ownHost(req.url));
    return { candidates, usedWebSearch: hasWebSearch };
  }
}
