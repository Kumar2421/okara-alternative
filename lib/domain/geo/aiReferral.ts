/** AI assistants that send visitors with a referrer. A floor: some visits carry no referrer at all. */
export const AI_REFERRAL_SOURCES = [
  "chatgpt.com",
  "chat.openai.com",
  "perplexity.ai",
  "claude.ai",
  "gemini.google.com",
  "copilot.microsoft.com",
] as const;

const ALIASES: Record<string, string> = {
  "www.perplexity.ai": "perplexity.ai",
  perplexity: "perplexity.ai",
  "www.chatgpt.com": "chatgpt.com",
  chatgpt: "chatgpt.com",
};

export type ReferralResult = {
  method: "referral";
  total: number;
  bySource: Array<{ source: string; sessions: number }>;
};

export function buildReferralReportBody(startDate: string, endDate: string) {
  return {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: "sessionSource" }],
    metrics: [{ name: "sessions" }],
    dimensionFilter: {
      filter: {
        fieldName: "sessionSource",
        inListFilter: { values: [...AI_REFERRAL_SOURCES, ...Object.keys(ALIASES)] },
      },
    },
  };
}

type GaRow = { dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> };

export function parseReferralRows(rows: GaRow[] | undefined): ReferralResult {
  const sums = new Map<string, number>();
  for (const r of rows ?? []) {
    const raw = (r.dimensionValues?.[0]?.value ?? "").toLowerCase();
    const source = (AI_REFERRAL_SOURCES as readonly string[]).includes(raw) ? raw : ALIASES[raw];
    if (!source) continue;
    sums.set(source, (sums.get(source) ?? 0) + Number(r.metricValues?.[0]?.value ?? 0));
  }
  const bySource = [...sums.entries()].map(([source, sessions]) => ({ source, sessions })).sort((a, b) => b.sessions - a.sessions);
  return { method: "referral", total: bySource.reduce((s, r) => s + r.sessions, 0), bySource };
}
