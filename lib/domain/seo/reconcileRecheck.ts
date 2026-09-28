import type { Finding as SeoFinding } from "@/lib/domain/seo/SEOAgent";
import { explainFinding } from "@/lib/domain/seo/findingExplanations";

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
