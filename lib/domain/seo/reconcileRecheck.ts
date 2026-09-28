import { explainFinding } from "./findingExplanations.ts";

// Deliberately not imported from ./SEOAgent: that file has a TS
// parameter-property constructor Node's --test runner (strip-only TS mode)
// can't parse. `import type` should be fully erased before resolution, but
// this file already burned two CI round-trips on that runner's quirks —
// safer to duplicate this narrow shape than depend on it.
type SeoFinding = {
  issueId: string;
  category: string;
  severity: "Warning" | "Error";
  label: string;
  evidence: Record<string, string | number | null>;
  autoFixable: boolean;
};

export type SeoAuditRecheckResult = {
  issueDetected: boolean;
  severity: "info" | "warning" | "critical";
  recommendation: string;
  evidence: Record<string, unknown>;
};

/**
 * Pure decision logic for rechecking a single SEO-audit finding: given a
 * fresh crawl's findings and the original finding's issueId, decide whether
 * that specific issue is still present — never a different, unrelated rule
 * (the bug this replaces: rechecking any finding against one hardcoded
 * indexable/canonical/relevance/TTFB check, regardless of which issue was
 * actually flagged).
 */
export function reconcileSeoAuditRecheck(
  entityId: string,
  freshFindings: SeoFinding[],
  previousSeverity: "info" | "warning" | "critical",
): SeoAuditRecheckResult {
  const stillPresent = freshFindings.find((f) => f.issueId === entityId) ?? null;

  if (!stillPresent) {
    return {
      issueDetected: false,
      severity: previousSeverity,
      recommendation: "Issue no longer detected. Keep the page under observation and re-check if it changes.",
      evidence: { resolved: true },
    };
  }

  const { whyItMatters, recommendation } = explainFinding(stillPresent);
  return {
    issueDetected: true,
    severity: stillPresent.severity === "Error" ? "critical" : "warning",
    recommendation,
    evidence: { label: stillPresent.label, whyItMatters, ...stillPresent.evidence },
  };
}
