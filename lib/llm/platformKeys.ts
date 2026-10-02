/**
 * Server-only, closed-source: platform-provided free-tier keys, set once as
 * real Vercel/host env vars by the operator (never present in
 * .env.opensource — self-host users always BYOK, see lib/features.ts).
 *
 * Single source of truth — every agent/document generation route and the
 * LLM Providers settings UI (via /api/providers) read this same map instead
 * of each keeping its own duplicate copy, so adding/removing a platform key
 * only has to happen in one place.
 */
export const PLATFORM_PROVIDER_KEYS: Record<string, string | undefined> = {
  groq: process.env.GROQ_API_KEY,
  mistral: process.env.MISTRAL_API_KEY,
};

/** Default model per platform-managed provider — same map /api/providers
 * uses to auto-assign a new hosted user's primaryModel, and what the free
 * auto lead-generation feature pins to (it always uses the platform's own
 * key, never a user's BYOK connection, so it needs one fixed model here). */
export const PLATFORM_DEFAULT_MODELS: Record<string, string> = {
  groq: "openai/gpt-oss-120b",
  mistral: "mistral-large-latest",
};

/** True when the platform operator has configured a real key for this
 * provider — safe to expose to the client as a boolean (never the key
 * itself). Used to show "Included with your plan" instead of a BYOK form. */
export function hasPlatformKey(providerId: string): boolean {
  return Boolean(PLATFORM_PROVIDER_KEYS[providerId]);
}
