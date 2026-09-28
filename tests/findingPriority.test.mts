import test from "node:test";
import assert from "node:assert/strict";
import { compareFindingsByPriority } from "../lib/domain/findings/findingPriority.ts";

test("sorts unresolved findings by severity, critical first", () => {
  const findings = [
    { id: "a", status: "new" as const, severity: "warning" as const },
    { id: "b", status: "new" as const, severity: "critical" as const },
  ];
  findings.sort(compareFindingsByPriority);
  assert.deepEqual(findings.map((f) => f.id), ["b", "a"]);
});

test("sorts a verified critical BELOW an unresolved warning", () => {
  // Reproduces the bug: without this, an old fixed critical outranks a live
  // warning, directly undermining "what should I fix first."
  const findings = [
    { id: "old-fixed-critical", status: "verified" as const, severity: "critical" as const },
    { id: "live-warning", status: "new" as const, severity: "warning" as const },
  ];
  findings.sort(compareFindingsByPriority);
  assert.deepEqual(findings.map((f) => f.id), ["live-warning", "old-fixed-critical"]);
});

test("keeps a 'failed' (still-detected on recheck) finding ranked by severity, not demoted", () => {
  const findings = [
    { id: "verified", status: "verified" as const, severity: "critical" as const },
    { id: "failed-critical", status: "failed" as const, severity: "critical" as const },
  ];
  findings.sort(compareFindingsByPriority);
  assert.deepEqual(findings.map((f) => f.id), ["failed-critical", "verified"]);
});
