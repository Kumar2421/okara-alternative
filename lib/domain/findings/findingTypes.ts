export const FINDING_STATUSES = ["new", "acknowledged", "fixing", "fixed", "verified", "failed"] as const;
export const FINDING_SEVERITIES = ["info", "warning", "critical"] as const;

export type FindingStatus = (typeof FINDING_STATUSES)[number];
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export type Finding = {
  id: string;
  projectId: string;
  source: string;
  category: string;
  severity: FindingSeverity;
  entityType: string;
  entityId: string;
  url: string | null;
  evidence: Record<string, unknown>;
  recommendation: string;
  status: FindingStatus;
  firstSeen: string;
  lastSeen: string;
  resolvedAt: string | null;
};
