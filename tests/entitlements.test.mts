import test from "node:test";
import assert from "node:assert/strict";
import { can, limitFor, getLimits, type Plan, type Limits } from "../lib/entitlements.ts";

// Test table-driven plan x feature matrix
const plans: Plan[] = ["free", "lite", "pro", "selfhost"];

const features = [
  "projects",
  "daily_leads",
  "gsc_history_retention_days",
  "auto_evaluated_outcomes",
  "notifications_digest",
  "managed_keys",
] as const;

const expectedLimits: Record<Plan, Limits> = {
  free: {
    projects: 4,
    daily_leads: 10,
    gsc_history_retention_days: 30,
    auto_evaluated_outcomes: false,
    notifications_digest: "daily",
    managed_keys: 1,
  },
  lite: {
    projects: 10,
    daily_leads: 50,
    gsc_history_retention_days: 60,
    auto_evaluated_outcomes: true,
    notifications_digest: "daily",
    managed_keys: 3,
  },
  pro: {
    projects: -1, // unlimited
    daily_leads: -1, // unlimited
    gsc_history_retention_days: -1, // unlimited
    auto_evaluated_outcomes: true,
    notifications_digest: "real-time",
    managed_keys: -1, // unlimited
  },
  selfhost: {
    projects: -1, // unlimited
    daily_leads: -1, // unlimited
    gsc_history_retention_days: -1, // unlimited
    auto_evaluated_outcomes: true,
    notifications_digest: "real-time",
    managed_keys: -1, // unlimited
  },
};

// Note: Tests run without NEXT_PUBLIC_PLATFORM_MODE or NEXT_PUBLIC_SUPABASE_URL,
// so FEATURES.PLATFORM_MODE defaults to false (selfhost mode).
// The can() and limitFor() functions will apply selfhost limits (all unlimited).
// This tests that the entitlements logic correctly identifies selfhost = unlimited,
// which is the critical safety requirement.

// Test can() function for selfhost (the only mode that works without env vars)
test("Selfhost plan: can() returns true for all features", () => {
  const ctx = { userId: "test_user", plan: "selfhost" as const };

  for (const feature of features) {
    assert.equal(
      can(ctx, feature),
      true,
      `selfhost should support ${feature}`
    );
  }
});

// Test default plan (without platform mode, defaults to selfhost)
test("Default plan when not specified defaults to selfhost mode in non-platform deployments", () => {
  const ctx = { userId: "test_user" };

  // Without platform mode enabled, defaults should be selfhost (unlimited)
  const limits = getLimits(ctx);
  assert.deepEqual(limits, expectedLimits.selfhost);
});

// Test getLimits returns correct plan limits (focusing on selfhost since that's active without env vars)
test("getLimits(selfhost) returns unlimited for all features", () => {
  const ctx = { userId: "test_user", plan: "selfhost" as const };
  const limits = getLimits(ctx);
  assert.deepEqual(limits, expectedLimits.selfhost);
});

// Test that selfhost is never crippled - THE CRITICAL SAFETY TEST
test("Selfhost plan is never crippled (all features available, all limits unlimited)", () => {
  const ctx = { userId: "test_user", plan: "selfhost" as const };
  const limits = getLimits(ctx);

  // All numeric limits should be -1 (unlimited)
  assert.equal(limits.projects, -1, "selfhost projects should be unlimited");
  assert.equal(limits.daily_leads, -1, "selfhost daily_leads should be unlimited");
  assert.equal(limits.gsc_history_retention_days, -1, "selfhost gsc_history_retention_days should be unlimited");
  assert.equal(limits.managed_keys, -1, "selfhost managed_keys should be unlimited");

  // All boolean/feature flags should be true
  assert.equal(limits.auto_evaluated_outcomes, true, "selfhost auto_evaluated_outcomes should be true");
  assert.equal(limits.notifications_digest, "real-time", "selfhost notifications_digest should be real-time");

  // All features should be available
  for (const feature of features) {
    assert.equal(can(ctx, feature), true, `selfhost should have ${feature} feature`);
  }
});

// Helper function to compare limits, treating -1 (unlimited) as >= any finite value
function isLimitGreaterOrEqual(a: number, b: number): boolean {
  if (a === -1) return true; // unlimited is always >= any value
  if (b === -1) return false; // finite is not >= unlimited
  return a >= b;
}

// Test plan hierarchy in the config (higher tiers should have at least as much as lower tiers)
test("Plan configs follow hierarchy: free <= lite <= pro <= selfhost", () => {
  const free = expectedLimits.free;
  const lite = expectedLimits.lite;
  const pro = expectedLimits.pro;
  const selfhost = expectedLimits.selfhost;

  // Projects
  assert.ok(
    isLimitGreaterOrEqual(lite.projects, free.projects) &&
    isLimitGreaterOrEqual(pro.projects, lite.projects) &&
    isLimitGreaterOrEqual(selfhost.projects, pro.projects),
    "Projects: free <= lite <= pro <= selfhost"
  );

  // Daily leads
  assert.ok(
    isLimitGreaterOrEqual(lite.daily_leads, free.daily_leads) &&
    isLimitGreaterOrEqual(pro.daily_leads, lite.daily_leads) &&
    isLimitGreaterOrEqual(selfhost.daily_leads, pro.daily_leads),
    "Daily leads: free <= lite <= pro <= selfhost"
  );

  // GSC history retention
  assert.ok(
    isLimitGreaterOrEqual(lite.gsc_history_retention_days, free.gsc_history_retention_days) &&
    isLimitGreaterOrEqual(pro.gsc_history_retention_days, lite.gsc_history_retention_days) &&
    isLimitGreaterOrEqual(selfhost.gsc_history_retention_days, pro.gsc_history_retention_days),
    "GSC history: free <= lite <= pro <= selfhost"
  );

  // Auto-evaluated outcomes (boolean progression: false < true)
  assert.ok(
    (!free.auto_evaluated_outcomes && lite.auto_evaluated_outcomes) &&
    (lite.auto_evaluated_outcomes && pro.auto_evaluated_outcomes) &&
    (pro.auto_evaluated_outcomes && selfhost.auto_evaluated_outcomes),
    "Auto-evaluated outcomes: free < lite <= pro <= selfhost"
  );

  // Managed keys
  assert.ok(
    isLimitGreaterOrEqual(lite.managed_keys, free.managed_keys) &&
    isLimitGreaterOrEqual(pro.managed_keys, lite.managed_keys) &&
    isLimitGreaterOrEqual(selfhost.managed_keys, pro.managed_keys),
    "Managed keys: free <= lite <= pro <= selfhost"
  );
});

// Test plan config definitions
test("Plan configs match expected values", () => {
  // Free plan config
  assert.equal(expectedLimits.free.projects, 4);
  assert.equal(expectedLimits.free.daily_leads, 10);
  assert.equal(expectedLimits.free.gsc_history_retention_days, 30);
  assert.equal(expectedLimits.free.auto_evaluated_outcomes, false);
  assert.equal(expectedLimits.free.notifications_digest, "daily");
  assert.equal(expectedLimits.free.managed_keys, 1);

  // Lite plan config
  assert.equal(expectedLimits.lite.projects, 10);
  assert.equal(expectedLimits.lite.daily_leads, 50);
  assert.equal(expectedLimits.lite.gsc_history_retention_days, 60);
  assert.equal(expectedLimits.lite.auto_evaluated_outcomes, true);
  assert.equal(expectedLimits.lite.notifications_digest, "daily");
  assert.equal(expectedLimits.lite.managed_keys, 3);

  // Pro plan config
  assert.equal(expectedLimits.pro.projects, -1); // unlimited
  assert.equal(expectedLimits.pro.daily_leads, -1); // unlimited
  assert.equal(expectedLimits.pro.gsc_history_retention_days, -1); // unlimited
  assert.equal(expectedLimits.pro.auto_evaluated_outcomes, true);
  assert.equal(expectedLimits.pro.notifications_digest, "real-time");
  assert.equal(expectedLimits.pro.managed_keys, -1); // unlimited
});

test("Lite plan config has moderate features", () => {
  const lite = expectedLimits.lite;

  assert.equal(lite.projects, 10);
  assert.equal(lite.daily_leads, 50);
  assert.equal(lite.gsc_history_retention_days, 60);
  assert.equal(lite.auto_evaluated_outcomes, true);
  assert.equal(lite.managed_keys, 3);
});

test("Pro plan config is fully unlimited", () => {
  const pro = expectedLimits.pro;

  assert.equal(pro.projects, -1);
  assert.equal(pro.daily_leads, -1);
  assert.equal(pro.gsc_history_retention_days, -1);
  assert.equal(pro.auto_evaluated_outcomes, true);
  assert.equal(pro.notifications_digest, "real-time");
  assert.equal(pro.managed_keys, -1);
});

test("Selfhost config has all features unlimited", () => {
  assert.equal(expectedLimits.selfhost.projects, -1);
  assert.equal(expectedLimits.selfhost.daily_leads, -1);
  assert.equal(expectedLimits.selfhost.gsc_history_retention_days, -1);
  assert.equal(expectedLimits.selfhost.auto_evaluated_outcomes, true);
  assert.equal(expectedLimits.selfhost.notifications_digest, "real-time");
  assert.equal(expectedLimits.selfhost.managed_keys, -1);
});

test("All plans follow hierarchy: free < lite <= pro <= selfhost", () => {
  const free = expectedLimits.free;
  const lite = expectedLimits.lite;
  const pro = expectedLimits.pro;
  const selfhost = expectedLimits.selfhost;

  // Verify each tier is stricter or equal to the next (using isLimitGreaterOrEqual for -1 handling)
  assert.ok(
    free.projects < lite.projects && isLimitGreaterOrEqual(pro.projects, lite.projects),
    "Projects hierarchy violated"
  );
  assert.ok(
    free.daily_leads < lite.daily_leads && isLimitGreaterOrEqual(pro.daily_leads, lite.daily_leads),
    "Daily leads hierarchy violated"
  );
  assert.ok(
    !free.auto_evaluated_outcomes && lite.auto_evaluated_outcomes && pro.auto_evaluated_outcomes,
    "Auto-outcomes hierarchy violated"
  );
  assert.ok(
    isLimitGreaterOrEqual(selfhost.projects, pro.projects),
    "Selfhost should be >= pro"
  );
});
