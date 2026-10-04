export type SearchIntent =
  | "brand"
  | "recommendation"
  | "alternative"
  | "comparison"
  | "pricing"
  | "review"
  | "how_to"
  | "problem"
  | "audience"
  | "commercial"
  | "informational";

export type QueryRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type ClassifiedQuery = {
  query: string;
  intent: SearchIntent;
  /** Every intent family the query matched, primary first. */
  signals: SearchIntent[];
  clicks: number;
  impressions: number;
  position: number;
};

export type IntentSummary = {
  intent: SearchIntent;
  queries: number;
  clicks: number;
  impressions: number;
  /** Share of analysed impressions, 0-1. */
  share: number;
};

/** A group of related queries about the same topic. */
export type SearchTheme = {
  /** Highest-impression query in the group, used as the display name. */
  label: string;
  intent: SearchIntent;
  queries: number;
  clicks: number;
  impressions: number;
  ctr: number;
  /** Impression-weighted average position. */
  position: number;
  /** Up to 3 member queries, highest impressions first. */
  examples: string[];
};

export type SearchInsights = {
  analysedQueries: number;
  intents: IntentSummary[];
  themes: SearchTheme[];
};
