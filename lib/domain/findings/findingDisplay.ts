import type { Finding } from "./findingTypes.ts";

/** A short, human title for a finding: the audit's own label when it has one, else the first sentence of the advice. */
export function findingTitle(finding: Pick<Finding, "evidence" | "recommendation">): string {
  const label = finding.evidence?.label;
  if (typeof label === "string" && label.trim()) return label.trim();
  const firstSentence = finding.recommendation.split(/(?<=[.!?])\s/)[0]?.trim();
  return firstSentence || "Untitled finding";
}

/** "https://example.com/blog/post?x=1" → "/blog/post"; the home page shows as "/". Falls back to the raw text. */
export function pagePath(url: string | null | undefined): string {
  if (!url) return "No page";
  try {
    const { pathname } = new URL(url);
    return pathname === "" ? "/" : pathname;
  } catch {
    return url;
  }
}

export type FindingCounts = { needsAttention: number; critical: number; warning: number; verified: number };

/** Headline numbers for the findings summary. A verified finding no longer needs attention. */
export function countFindings(findings: Array<Pick<Finding, "severity" | "status">>): FindingCounts {
  const open = findings.filter((f) => f.status !== "verified");
  return {
    needsAttention: open.length,
    critical: open.filter((f) => f.severity === "critical").length,
    warning: open.filter((f) => f.severity === "warning").length,
    verified: findings.length - open.length,
  };
}
