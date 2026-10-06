import { FEATURES } from "./features.ts";

/**
 * Entitlements and plan limits.
 * Rule: logic is open, operations/scale are paid; self-host (OSS) must never be crippled.
 *
 * Plans mapped from profiles.plan_tier:
 * - 'free' -> free (1 project, 10 daily leads)
 * - 'lite' -> lite (3 projects, 50 daily leads)
 * - 'pro' -> pro (unlimited projects, unlimited daily leads)
 * - selfhost mode -> selfhost (all unlimited)
 */

export type Plan = "free" | "lite" | "pro" | "selfhost";

export type Limits = {
  projects: number;
  daily_leads: number;
  gsc_history_retention_days: number;
  auto_evaluated_outcomes: boolean;
  notifications_digest: "daily" | "real-time";
  managed_keys: number;
};

export type EntitlementContext = {
  userId: string;
  plan?: Plan;
};

// Plan definitions and their limits
const PLAN_LIMITS: Record<Plan, Limits> = {
  free: {
    projects: 4,
    daily_leads: 10,
    gsc_history_retention_days: 30,
    auto_evaluated_outcomes: false,
    notifications_digest: "daily",
    managed_keys: 1,
  },
  lite: {
    projects: 3,
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

/**
 * Get user's current plan from profiles.plan_tier.
 * Platform mode: reads from Supabase profiles table.
 * Self-host: always "selfhost".
 *
 * Fails open: on error, returns "pro" (most permissive paid tier) to avoid
 * capping paying users. Logs warning without PII.
 */
export async function getUserPlan(userId: string): Promise<Plan> {
  // Self-host always has unlimited plan
  if (!FEATURES.PLATFORM_MODE) {
    return "selfhost";
  }

  try {
    // Lazy-load Supabase client to avoid import issues in tests
    const { createServiceClient } = await import("@/utils/supabase/serviceClient.ts");
    const db = createServiceClient();
    const { data, error } = await db
      .from("profiles")
      .select("plan_tier")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      // Fail open: on lookup error, allow the action and warn
      console.warn("Could not verify user plan tier:", error.code);
      return "pro";
    }

    if (!data) {
      // Profile missing — treat as free only if completely missing
      return "free";
    }

    // Map database tier to plan
    const tier = data.plan_tier as string;
    if (tier === "lite") return "lite";
    if (tier === "pro") return "pro";
    return "free"; // default
  } catch {
    // Fail open: on any unexpected error, allow the action and warn
    console.warn("Entitlements lookup error");
    return "pro";
  }
}

/**
 * Check if a feature is available for the user's plan.
 * Returns true if feature is available, false otherwise.
 */
export function can(ctx: EntitlementContext, feature: keyof Limits): boolean {
  const plan = ctx.plan || "free";

  // Self-host mode: all features available except those explicitly false
  if (!FEATURES.PLATFORM_MODE) {
    const limits = PLAN_LIMITS.selfhost;
    const limit = limits[feature];

    if (feature === "auto_evaluated_outcomes" || feature === "notifications_digest") {
      return true;
    }
    return limit !== false && limit !== 0;
  }

  const limits = PLAN_LIMITS[plan];
  const limit = limits[feature];

  // For boolean features
  if (typeof limit === "boolean") {
    return limit;
  }

  // For string features (notifications_digest)
  if (feature === "notifications_digest") {
    return true;
  }

  // For numeric features (projects, daily_leads, managed_keys)
  return limit !== 0;
}

/**
 * Get the limit value for a feature.
 * Returns -1 for unlimited, or the numeric/string value.
 * For self-host in platform mode, returns unlimited (-1).
 */
export function limitFor(ctx: EntitlementContext, key: keyof Limits): Limits[keyof Limits] {
  const plan = ctx.plan || "free";

  // Self-host mode: all limits are unlimited for numeric/scale features
  if (!FEATURES.PLATFORM_MODE) {
    return PLAN_LIMITS.selfhost[key];
  }

  return PLAN_LIMITS[plan][key];
}

/**
 * Get all limits for a user's plan.
 */
export function getLimits(ctx: EntitlementContext): Limits {
  const plan = ctx.plan || "free";

  if (!FEATURES.PLATFORM_MODE) {
    return PLAN_LIMITS.selfhost;
  }

  return PLAN_LIMITS[plan];
}

/**
 * Check if user has reached a project limit.
 * Returns { allowed: boolean, remaining: number, limit: number, message?: string }
 */
export async function canCreateProject(userId: string): Promise<{
  allowed: boolean;
  remaining: number;
  limit: number;
  message?: string;
}> {
  // Self-host: always allowed
  if (!FEATURES.PLATFORM_MODE) {
    return { allowed: true, remaining: -1, limit: -1 };
  }

  const plan = await getUserPlan(userId);
  const ctx = { userId, plan };
  const projectLimit = limitFor(ctx, "projects") as number;

  // -1 means unlimited
  if (projectLimit === -1) {
    return { allowed: true, remaining: -1, limit: -1 };
  }

  try {
    // Lazy-load Supabase client to avoid import issues in tests
    const { createServiceClient } = await import("@/utils/supabase/serviceClient.ts");
    const db = createServiceClient();
    const { count, error } = await db
      .from("projects")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", userId);

    if (error) {
      // Fail open: on lookup error, allow and warn
      console.warn("Could not verify project count:", error.code);
      return { allowed: true, remaining: projectLimit, limit: projectLimit };
    }

    const projectCount = count || 0;
    const remaining = Math.max(0, projectLimit - projectCount);

    if (projectCount >= projectLimit) {
      return {
        allowed: false,
        remaining: 0,
        limit: projectLimit,
        message: `Project limit reached (${projectLimit} projects). Upgrade your plan to create more.`,
      };
    }

    return { allowed: true, remaining, limit: projectLimit };
  } catch {
    // Fail open: on unexpected error, allow and warn
    console.warn("Project limit check error");
    return { allowed: true, remaining: projectLimit, limit: projectLimit };
  }
}

/**
 * Check if user can fetch more leads today.
 * Returns { allowed: boolean, remaining: number, limit: number, message?: string }
 */
export async function canFetchLeadsToday(userId: string): Promise<{
  allowed: boolean;
  remaining: number;
  limit: number;
  message?: string;
}> {
  // Self-host: always allowed
  if (!FEATURES.PLATFORM_MODE) {
    return { allowed: true, remaining: -1, limit: -1 };
  }

  const plan = await getUserPlan(userId);
  const ctx = { userId, plan };
  const dailyLeadsLimit = limitFor(ctx, "daily_leads") as number;

  // -1 means unlimited
  if (dailyLeadsLimit === -1) {
    return { allowed: true, remaining: -1, limit: -1 };
  }

  try {
    // Lazy-load Supabase client to avoid import issues in tests
    const { createServiceClient } = await import("@/utils/supabase/serviceClient.ts");
    const db = createServiceClient();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    // Count leads created by this user's projects today
    const { data: projects } = await db
      .from("projects")
      .select("id")
      .eq("owner_id", userId);

    if (!projects || projects.length === 0) {
      return { allowed: true, remaining: dailyLeadsLimit, limit: dailyLeadsLimit };
    }

    const projectIds = projects.map((p) => p.id);

    const { count, error } = await db
      .from("leads")
      .select("*", { count: "exact", head: true })
      .in("project_id", projectIds)
      .gte("created_at", todayStr);

    if (error) {
      // Fail open: on lookup error, allow and warn
      console.warn("Could not verify daily leads count:", error.code);
      return { allowed: true, remaining: dailyLeadsLimit, limit: dailyLeadsLimit };
    }

    const leadsCount = count || 0;
    const remaining = Math.max(0, dailyLeadsLimit - leadsCount);

    if (leadsCount >= dailyLeadsLimit) {
      return {
        allowed: false,
        remaining: 0,
        limit: dailyLeadsLimit,
        message: `Daily lead limit reached (${dailyLeadsLimit} leads). Check back tomorrow or upgrade your plan.`,
      };
    }

    return { allowed: true, remaining, limit: dailyLeadsLimit };
  } catch {
    // Fail open: on unexpected error, allow and warn
    console.warn("Daily leads limit check error");
    return { allowed: true, remaining: dailyLeadsLimit, limit: dailyLeadsLimit };
  }
}

/**
 * Get GSC history retention days for snapshot pruning.
 * Returns the number of days to keep, or -1 for unlimited.
 */
export async function getGscHistoryRetentionDays(userId: string): Promise<number> {
  // Self-host: unlimited
  if (!FEATURES.PLATFORM_MODE) {
    return -1;
  }

  const plan = await getUserPlan(userId);
  const ctx = { userId, plan };
  return limitFor(ctx, "gsc_history_retention_days") as number;
}

/**
 * Error classes for entitlements violations
 */
export class ProjectLimitExceededError extends Error {
  limit: number;
  remaining: number;

  constructor(limit: number, remaining: number) {
    super(`project_limit_exceeded`);
    this.name = "ProjectLimitExceededError";
    this.limit = limit;
    this.remaining = remaining;
  }
}

export class DailyLeadsLimitExceededError extends Error {
  limit: number;
  remaining: number;

  constructor(limit: number, remaining: number) {
    super(`daily_leads_limit_exceeded`);
    this.name = "DailyLeadsLimitExceededError";
    this.limit = limit;
    this.remaining = remaining;
  }
}
