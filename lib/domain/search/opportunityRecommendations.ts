import type { Recommendation, RecommendationPriority } from "../recommendations/recommendationTypes.ts";
import { opportunityEvidenceOf, type OpportunityEvidence } from "./opportunityFinding.ts";
import { expectedCtr } from "./searchOpportunities.ts";

type FindingLike = { id: string; url: string | null; evidence: Record<string, unknown> };

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "for", "in", "of", "on", "or", "the", "to", "vs", "with"]);
const TITLE_LIMIT = 60;

function titleCase(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .map((word, index) => (index > 0 && SMALL_WORDS.has(word.toLowerCase()) ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

/**
 * A starting title built from the search wording, kept within the length
 * search results show (~60 characters). Deterministic, so it is a draft to
 * edit, never presented as final copy.
 */
export function suggestTitle(query: string, brand: string | null): string {
  const core = titleCase(query);
  const withBrand = brand ? `${core} | ${brand}` : core;
  if (withBrand.length <= TITLE_LIMIT) return withBrand;
  if (core.length <= TITLE_LIMIT) return core;
  const words = core.split(" ");
  let out = "";
  for (const word of words) {
    if ((out + " " + word).trim().length > TITLE_LIMIT - 1) break;
    out = (out + " " + word).trim();
  }
  return out;
}

const n = (value: number) => Math.round(value).toLocaleString("en-US");
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const priorityByViews = (views: number): RecommendationPriority => (views >= 1000 ? "high" : "medium");

function make(
  finding: FindingLike,
  e: OpportunityEvidence,
  type: Recommendation["type"],
  title: string,
  summary: string,
  priority: RecommendationPriority,
  kind: Recommendation["implementation"]["kind"],
  description: string,
): Recommendation {
  return {
    id: `${finding.id}:${type}`,
    findingId: finding.id,
    type,
    title,
    summary,
    priority,
    target: { url: finding.url ?? undefined, query: e.query },
    evidence: { opportunity: e.opportunity.type, impressions: e.impressions, position: e.position, ctr: e.ctr, previous: e.previous },
    implementation: { kind, description },
  };
}

/**
 * Concrete, deterministic next steps for a finding that came from a search
 * opportunity. No AI: each step is a checklist grounded in the numbers that
 * flagged it, written so a non-expert can act on it.
 */
export function deriveOpportunityRecommendations(finding: FindingLike): Recommendation[] | null {
  const e = opportunityEvidenceOf(finding.evidence);
  if (!e) return null;
  const title = suggestTitle(e.query, e.brand);
  const hasPage = Boolean(finding.url);

  switch (e.opportunity.type) {
    case "ranking":
      return [
        make(
          finding,
          e,
          "improve_search_intent_alignment",
          `Make this page answer “${e.query}” directly`,
          `${n(e.impressions)} people saw you for this at position ${e.position.toFixed(1)}. The page already ranks, so matching it to the search is the fastest win.`,
          priorityByViews(e.impressions),
          "content",
          [
            `1. Put “${e.query}” (or a close variant) in the page title and main heading. Draft title: “${title}”.`,
            "2. Answer it in plain words in the first paragraph.",
            "3. Add a short section for the related questions people ask next.",
            "4. Link to this page from 2–3 related pages, using descriptive link text.",
            "Then re-check after Google has had a few weeks to re-crawl.",
          ].join("\n"),
        ),
      ];

    case "ctr": {
      const typical = expectedCtr(e.position);
      return [
        make(
          finding,
          e,
          "rewrite_snippet",
          "Rewrite the title and description to win more clicks",
          `You rank near the top (position ${e.position.toFixed(1)}) but only ${pct(e.ctr)} click, where about ${pct(typical)} is typical.`,
          priorityByViews(e.impressions),
          "content",
          [
            `1. Draft title: “${title}”. Start with the search wording, add one specific benefit or number, and stay under 60 characters.`,
            "2. Write a 120–155 character description that says who it is for and ends with a clear next step.",
            "3. Update both, then re-check in 2–4 weeks.",
          ].join("\n"),
        ),
      ];
    }

    case "declining": {
      const before = e.previous;
      const moved = before ? `Your position slipped from ${before.position.toFixed(1)} to ${e.position.toFixed(1)}` : `You now average position ${e.position.toFixed(1)}`;
      const views = before ? ` and views fell from ${n(before.impressions)} to ${n(e.impressions)}` : "";
      return [
        make(
          finding,
          e,
          "investigate_decline",
          "Find out why you slipped, and win the ground back",
          `${moved}${views}.`,
          "high",
          "manual",
          [
            "1. Check whether the page changed recently: title, headings, redirects, noindex or canonical.",
            "2. Confirm it is still in your sitemap and linked from other pages.",
            `3. Search “${e.query}” yourself and note who ranks above you now and what they added.`,
            "4. Restore what worked, then strengthen the page. Re-check in 2–4 weeks.",
          ].join("\n"),
        ),
      ];
    }

    case "new_query":
      return [
        make(
          finding,
          e,
          "build_on_new_query",
          hasPage ? "Build on this new search" : "Give this new search its own page",
          `New in the last 28 days: ${n(e.impressions)} views at position ${e.position.toFixed(1)}.`,
          "medium",
          "content",
          hasPage
            ? [
                `1. Check the ranking page answers “${e.query}” directly.`,
                "2. Add a short section or FAQ for it, under its own heading.",
                "3. Link to the page from 2–3 related pages so it can keep climbing.",
              ].join("\n")
            : [
                `1. Create a page that answers “${e.query}” directly. Draft title: “${title}”.`,
                "2. Link to it from 2–3 related pages.",
              ].join("\n"),
        ),
      ];

    case "lost_query":
      return [
        make(
          finding,
          e,
          "investigate_lost_query",
          "Find out why this search stopped showing your site",
          `You had ${n(e.previous?.impressions ?? 0)} views for this before, and none in the last 28 days.`,
          "high",
          "manual",
          [
            "1. Check whether the page was removed, redirected, set to noindex or blocked in robots.txt.",
            "2. If it was removed on purpose, you can ignore this.",
            "3. Otherwise restore it, or redirect it to the closest relevant page.",
          ].join("\n"),
        ),
      ];
  }
}
