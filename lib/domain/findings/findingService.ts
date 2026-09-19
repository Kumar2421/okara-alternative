import type { Finding, FindingSeverity, FindingStatus } from "./findingTypes";
import { canTransitionFinding } from "./findingTypes";

export type FindingRepository = {
  get(projectId: string, id: string): Promise<Finding | null> | Finding | null;
  list(projectId: string): Promise<Finding[]> | Finding[];
  transition(projectId: string, id: string, status: FindingStatus): Promise<Finding | null> | Finding | null;
  refresh(projectId: string, id: string, input: {
    severity: FindingSeverity;
    evidence: Record<string, unknown>;
    recommendation: string;
    status: FindingStatus;
  }): Promise<Finding | null> | Finding | null;
};

export type FindingRecheckResult = {
  severity: FindingSeverity;
  evidence: Record<string, unknown>;
  recommendation: string;
  issueDetected: boolean;
};

export async function getFinding(
  repository: FindingRepository,
  projectId: string,
  id: string,
): Promise<Finding | null> {
  return repository.get(projectId, id);
}

export async function listFindings(
  repository: FindingRepository,
  projectId: string,
): Promise<Finding[]> {
  return repository.list(projectId);
}

export async function transitionFinding(
  repository: FindingRepository,
  projectId: string,
  id: string,
  status: FindingStatus,
): Promise<Finding | null> {
  const finding = await repository.get(projectId, id);
  if (!finding) return null;
  if (!canTransitionFinding(finding.status, status)) {
    throw new Error(`Invalid finding status transition: ${finding.status} -> ${status}`);
  }
  return repository.transition(projectId, id, status);
}

export async function applyRecheck(
  repository: FindingRepository,
  projectId: string,
  id: string,
  result: FindingRecheckResult,
): Promise<Finding | null> {
  const finding = await repository.get(projectId, id);
  if (!finding) return null;

  const status: FindingStatus = result.issueDetected ? "failed" : "verified";
  return repository.refresh(projectId, id, {
    severity: result.severity,
    evidence: result.evidence,
    recommendation: result.recommendation,
    status,
  });
}
