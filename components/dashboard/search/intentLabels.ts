import type { SearchIntent } from "@/lib/domain/search/types";

/** What the searcher is trying to do, in words a non-expert understands. */
export const INTENT_LABELS: Record<SearchIntent, string> = {
  recommendation: "Looking for the best option",
  alternative: "Looking for alternatives",
  comparison: "Comparing options",
  pricing: "Asking about price",
  review: "Reading reviews",
  how_to: "Learning how to do something",
  problem: "Trying to fix a problem",
  audience: "Searching for their kind of business",
  commercial: "Shopping for a tool or service",
  brand: "Looking for you by name",
  informational: "General questions",
};

export function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
