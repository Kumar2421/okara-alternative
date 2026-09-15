/**
 * Feature flags for SaaS vs Self-Host builds
 * Controls which settings sections and features are visible
 */

export const FEATURES = {
  /** Self-host mode: users configure everything */
  SELF_HOST: process.env.NEXT_PUBLIC_SELF_HOST === "true",

  /** Show LLM provider settings (self-host only) */
  SHOW_LLM_SETTINGS: process.env.NEXT_PUBLIC_SHOW_LLM_SETTINGS === "true",

  /** Show API credentials section (self-host only) */
  SHOW_API_CREDENTIALS: process.env.NEXT_PUBLIC_SHOW_API_CREDENTIALS === "true",

  /** Platform mode: hide self-host configs, show team management */
  PLATFORM_MODE: process.env.NEXT_PUBLIC_PLATFORM_MODE === "true",
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
