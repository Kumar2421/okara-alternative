export const RECOMMENDATION_TYPES = [
  "missing_canonical",
  "noindex",
  "low_keyword_relevance",
  "slow_ttfb",
] as const;

export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];
export type RecommendationPriority = "low" | "medium" | "high";

export type Recommendation = {
  id: string;
  findingId: string;
  type: RecommendationType;
  title: string;
  summary: string;
  priority: RecommendationPriority;
  target: { url?: string; query?: string };
  evidence: Record<string, unknown>;
  implementation: {
    kind: "manual" | "content" | "code";
    description: string;
  };
};
