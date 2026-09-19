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

export const FINDING_TRANSITIONS: Record<FindingStatus, FindingStatus[]> = {
  new: ["acknowledged"],
  acknowledged: ["fixing"],
  fixing: ["fixed", "failed"],
  fixed: ["verified", "failed"],
  verified: ["fixing"],
  failed: ["fixing"],
};

export function canTransitionFinding(from: FindingStatus, to: FindingStatus): boolean {
  return FINDING_TRANSITIONS[from].includes(to);
}
