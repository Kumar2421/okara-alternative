import type { LlmDriver } from "@/lib/llm";
import { tavilySearchRaw, type TavilyResult } from "@/lib/domain/shared/webSearchTool";

export type LeadSearchQuery = {
  role: string;
  companyOrIndustry: string;
  location: string;
};

export type ExtractedLead = {
  name: string;
  title: string;
  company: string;
  location: string;
  email: string | null;
  sourceUrl: string | null;
};

const MAX_LEADS = 15;

function buildSearchQueries(q: LeadSearchQuery): string[] {
  const parts = [q.role, q.companyOrIndustry, q.location].filter(Boolean).join(" ");
  return [
    `"${q.role}" ${q.companyOrIndustry} ${q.location} site:linkedin.com/in`,
    `${parts} email contact`,
  ].filter((s) => s.trim().length > 0);
}

/** Same quirk-tolerant JSON extraction as CompetitorDiscoveryAgent — small
 * models wrap arrays in code fences or add a sentence around them. */
function parseLeads(raw: string): ExtractedLead[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: ExtractedLead[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    out.push({
      name,
      title: typeof o.title === "string" ? o.title.trim() : "",
      company: typeof o.company === "string" ? o.company.trim() : "",
      location: typeof o.location === "string" ? o.location.trim() : "",
      email: typeof o.email === "string" && o.email.trim() ? o.email.trim() : null,
      sourceUrl: typeof o.sourceUrl === "string" && o.sourceUrl.trim() ? o.sourceUrl.trim() : null,
    });
    if (out.length >= MAX_LEADS) break;
  }
  return out;
}

/**
 * Real lead search — deterministic Tavily queries built from the user's
 * role/company/location input (not model-decided, so results are
 * reproducible), then an LLM extraction pass over the REAL search results
 * only. The model is never asked to invent a person; it's asked to pull
 * structured fields out of snippets it's actually given, and to leave email
 * null rather than guess a pattern like first.last@company.com — a
 * plausible-looking wrong email is worse than an honest gap.
 */
export class LeadsAgent {
  constructor(private driver: LlmDriver, private apiKey: string, private baseUrl?: string) {}

  async search(query: LeadSearchQuery, tavilyApiKey: string, model: string): Promise<ExtractedLead[]> {
    const queries = buildSearchQueries(query);
    const resultSets = await Promise.all(
      queries.map((q) => tavilySearchRaw(tavilyApiKey, q, 8).catch(() => [] as TavilyResult[]))
    );
    const allResults = resultSets.flat();
    if (allResults.length === 0) return [];

    const resultsBlock = allResults
      .map((r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   Snippet: ${r.content.slice(0, 400)}`)
      .join("\n\n");

    const system = `You are a research assistant extracting real people from real web search results — you
are NOT generating leads from imagination. Every person, title, company, location, and
email you output must come directly from the snippet text given below. If a field
isn't stated in the snippet, leave it empty ("" for text fields, null for email) —
never guess an email address pattern, never invent a location or title that isn't there.
Skip a result entirely if it's not actually a person (e.g. a job listing page, a
company directory, an article) rather than forcing it into a fake lead.

Respond with ONLY a JSON array, no markdown code fences, no prose before or after it,
in exactly this shape:
[{"name": "Jane Doe", "title": "VP Marketing", "company": "Acme Inc", "location": "Austin, TX", "email": null, "sourceUrl": "https://..."}]`;

    const prompt = `Search target: role="${query.role}", company/industry="${query.companyOrIndustry}", location="${query.location}"

Real search results:
${resultsBlock}

Extract up to ${MAX_LEADS} distinct real people from the results above.`;

    const result = await this.driver({
      apiKey: this.apiKey,
      model,
      system,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      baseUrl: this.baseUrl,
    });

    return parseLeads(result.text ?? "");
  }
}
