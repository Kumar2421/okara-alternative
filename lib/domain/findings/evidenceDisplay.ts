/**
 * The dashboard's "Why this was flagged" panel was hardcoded to one
 * evidence shape (Clicks/Impressions/CTR/Position/Indexable/Canonical/
 * Keyword relevance/TTFB) regardless of a finding's source. That shape only
 * exists for analytics/search-console findings -- for seo-audit findings
 * (the majority-source findings: meta title/description, canonical,
 * headings, OG/Twitter tags), every one of those fields is undefined, so
 * the panel silently rendered nothing (EvidenceValue hides null/undefined
 * rows) instead of the finding's actual evidence.
 *
 * This branches by source so each finding type shows its own real evidence.
 */

export type EvidenceRow = { key: string; label: string; value: unknown };

const OPPORTUNITY_LABEL: Record<string, string> = {
  ranking: "Close to page one",
  ctr: "Ranks well, few click",
  declining: "Slipping",
  new_query: "New search",
  lost_query: "No longer showing",
};

function humanizeKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

export function evidenceRowsForFinding(finding: { source: string; evidence: Record<string, unknown> }): EvidenceRow[] {
  if (finding.source === "seo-audit") {
    // whyItMattersForFinding() surfaces `whyItMatters` separately, and
    // `label` duplicates the finding's own title shown elsewhere in the
    // panel -- both excluded here so this list is just the raw evidence.
    return Object.entries(finding.evidence)
      .filter(([key]) => key !== "label" && key !== "whyItMatters")
      .map(([key, value]) => ({ key, label: humanizeKey(key), value }));
  }

  const opportunity = finding.evidence.opportunity as { type?: string; reasons?: string[] } | undefined;
  if (opportunity?.type) {
    const e = finding.evidence;
    const previous = (e.previous ?? null) as { position?: number; impressions?: number } | null;
    return [
      { key: "query", label: "Search", value: e.query },
      { key: "type", label: "Opportunity", value: OPPORTUNITY_LABEL[opportunity.type] ?? opportunity.type },
      { key: "impressions", label: "Views (28 days)", value: typeof e.impressions === "number" ? Math.round(e.impressions).toLocaleString("en-US") : e.impressions },
      { key: "clicks", label: "Clicks", value: e.clicks },
      { key: "ctr", label: "Click rate", value: typeof e.ctr === "number" ? `${(e.ctr * 100).toFixed(1)}%` : e.ctr },
      { key: "position", label: "Average position", value: typeof e.position === "number" && e.position > 0 ? e.position.toFixed(1) : null },
      { key: "previousPosition", label: "Position before", value: typeof previous?.position === "number" ? previous.position.toFixed(1) : null },
      { key: "lastCheck", label: "Latest check", value: (e.lastCheck as { reason?: string } | undefined)?.reason ?? null },
      { key: "previousImpressions", label: "Views before", value: typeof previous?.impressions === "number" ? Math.round(previous.impressions).toLocaleString("en-US") : null },
    ];
  }

  const page = (finding.evidence.page ?? {}) as Record<string, unknown>;
  const meta = (page.meta ?? {}) as Record<string, unknown>;
  const relevance = (page.contentRelevance ?? {}) as Record<string, unknown>;
  const timing = (page.serverTiming ?? {}) as Record<string, unknown>;
  const ctr = finding.evidence.ctr;
  const keywordRelevance = relevance.keywordRelevance;
  const ttfbMs = timing.ttfbMs;

  return [
    { key: "clicks", label: "Clicks", value: finding.evidence.clicks },
    { key: "impressions", label: "Impressions", value: finding.evidence.impressions },
    { key: "ctr", label: "CTR", value: typeof ctr === "number" ? `${(ctr * 100).toFixed(1)}%` : ctr },
    { key: "position", label: "Position", value: finding.evidence.position },
    { key: "indexable", label: "Indexable", value: meta.indexable },
    { key: "canonical", label: "Canonical", value: meta.canonical ?? "Missing" },
    { key: "keywordRelevance", label: "Keyword relevance", value: typeof keywordRelevance === "number" ? `${keywordRelevance}%` : keywordRelevance },
    { key: "ttfb", label: "TTFB", value: typeof ttfbMs === "number" ? `${Math.round(ttfbMs)} ms` : null },
  ];
}

export function whyItMattersForFinding(finding: { source: string; evidence: Record<string, unknown> }): string | null {
  if (finding.source === "seo-audit" && typeof finding.evidence.whyItMatters === "string") {
    return finding.evidence.whyItMatters;
  }
  const opportunity = finding.evidence.opportunity as { reasons?: unknown } | undefined;
  if (opportunity && Array.isArray(opportunity.reasons) && opportunity.reasons.length > 0) {
    return opportunity.reasons.filter((r): r is string => typeof r === "string").join(". ") + ".";
  }
  return null;
}
