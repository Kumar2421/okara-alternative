import { FEATURES } from "./features.ts";

/**
 * Entitlements and plan limits.
 * Rule: logic is open, operations/scale are paid; self-host (OSS) must never be crippled.
 */

export type Plan = "free" | "pro" | "agency" | "selfhost";

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
    projects: 1,
    daily_leads: 10,
    gsc_history_retention_days: 30,
    auto_evaluated_outcomes: false,
    notifications_digest: "daily",
    managed_keys: 1,
  },
  pro: {
    projects: 5,
    daily_leads: 100,
    gsc_history_retention_days: 90,
    auto_evaluated_outcomes: true,
    notifications_digest: "daily",
    managed_keys: -1, // unlimited
  },
  agency: {
    projects: 50,
    daily_leads: 500,
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
 * Get user's current plan.
 * Platform mode: reads from Supabase user_plans table.
 * Self-host: always "selfhost".
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
      .from("user_plans")
      .select("plan")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("Error fetching user plan:", error);
      return "free";
    }

    const plan = data?.plan as Plan | undefined;
    return plan || "free";
  } catch (error) {
    console.error("Error fetching user plan:", error);
    return "free";
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
      console.error("Error counting projects:", error);
      return { allowed: false, remaining: 0, limit: projectLimit, message: "Could not verify project limit" };
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
  } catch (error) {
    console.error("Error checking project limit:", error);
    return { allowed: false, remaining: 0, limit: projectLimit, message: "Could not verify project limit" };
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
      console.error("Error counting daily leads:", error);
      return { allowed: false, remaining: 0, limit: dailyLeadsLimit, message: "Could not verify daily lead limit" };
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
  } catch (error) {
    console.error("Error checking daily leads limit:", error);
    return { allowed: false, remaining: 0, limit: dailyLeadsLimit, message: "Could not verify daily lead limit" };
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
