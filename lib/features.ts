/**
 * Feature flags for SaaS vs Self-Host builds
 * Controls which settings sections and features are visible
 */

const hasSupabasePlatformConfig = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export const FEATURES = {
  /** Self-host mode: users configure everything */
  SELF_HOST: process.env.NEXT_PUBLIC_SELF_HOST === "true",

  /** Show LLM provider settings (self-host only) */
  SHOW_LLM_SETTINGS: process.env.NEXT_PUBLIC_SHOW_LLM_SETTINGS === "true",

  /** Show API credentials section (self-host only) */
  SHOW_API_CREDENTIALS: process.env.NEXT_PUBLIC_SHOW_API_CREDENTIALS === "true",

  /**
   * Platform mode: use Supabase-backed persistence and hide self-host configs.
   *
   * An explicit NEXT_PUBLIC_PLATFORM_MODE=true still enables platform mode,
   * while configured public Supabase credentials enable it automatically
   * unless NEXT_PUBLIC_SELF_HOST=true is set. This prevents a hosted
   * deployment from silently falling back to process-local SQLite when the
   * mode flag was omitted. Server routes still require SUPABASE_SECRET_KEY
   * when they create the service-role client.
   */
  PLATFORM_MODE:
    process.env.NEXT_PUBLIC_PLATFORM_MODE === "true" ||
    (process.env.NEXT_PUBLIC_SELF_HOST !== "true" && hasSupabasePlatformConfig),
};

/** Log active features at startup */
export function logFeatures() {
  if (typeof window === "undefined") return; // Server-side only
  console.log("[Features]", {
    selfHost: FEATURES.SELF_HOST,
    showLLMSettings: FEATURES.SHOW_LLM_SETTINGS,
    showApiCredentials: FEATURES.SHOW_API_CREDENTIALS,
    platformMode: FEATURES.PLATFORM_MODE,
  });
}
