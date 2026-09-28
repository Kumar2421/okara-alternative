export const AUDIT_FUNNEL_EVENTS = [
  "audit_started",
  "audit_completed",
  "audit_failed",
  "signup_cta_clicked",
] as const;

export type AuditFunnelEvent = (typeof AUDIT_FUNNEL_EVENTS)[number];

export type AuditFunnelPayload = {
  event: AuditFunnelEvent;
  findingCount?: number;
  criticalCount?: number;
  warningCount?: number;
  failureCode?: "request_failed" | "invalid_response" | "unknown";
};

const MAX_COUNT = 1000;

function safeCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(MAX_COUNT, Math.floor(value)));
}

export function sanitizeAuditFunnelPayload(input: AuditFunnelPayload): AuditFunnelPayload {
  return {
    event: input.event,
    findingCount: safeCount(input.findingCount),
    criticalCount: safeCount(input.criticalCount),
    warningCount: safeCount(input.warningCount),
    failureCode: input.failureCode,
  };
}

export function recordAuditFunnelEvent(input: AuditFunnelPayload): void {
  const payload = sanitizeAuditFunnelPayload(input);
  console.info("[audit-funnel]", JSON.stringify(payload));
}
