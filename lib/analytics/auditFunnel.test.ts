import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeAuditFunnelPayload } from "./auditFunnel";

test("keeps only bounded funnel metadata", () => {
  assert.deepEqual(
    sanitizeAuditFunnelPayload({
      event: "audit_completed",
      findingCount: 12.8,
      criticalCount: 2,
      warningCount: 7,
      failureCode: undefined,
    }),
    {
      event: "audit_completed",
      findingCount: 12,
      criticalCount: 2,
      warningCount: 7,
      failureCode: undefined,
    },
  );
});

test("drops invalid counts instead of leaking arbitrary payload values", () => {
  assert.deepEqual(
    sanitizeAuditFunnelPayload({
      event: "audit_failed",
      findingCount: Number.NaN,
      criticalCount: -4,
      warningCount: 5000,
      failureCode: "request_failed",
    }),
    {
      event: "audit_failed",
      findingCount: undefined,
      criticalCount: 0,
      warningCount: 1000,
      failureCode: "request_failed",
    },
  );
});
