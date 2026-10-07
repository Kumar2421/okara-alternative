import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * In hosted mode these service credentials are operator-managed through
 * deployment environment variables. They must never be collected from an
 * end user. Self-host keeps the existing per-user SQLite settings path.
 *
 * Four read sites had copied the provider_connections+Vault lookup instead
 * (site-crawl/pagespeed, seo/audit, analytics/findings's recheck path, and
 * geo/check), so a key saved through the UI was silently invisible to all
 * of them -- for geo/check and site-crawl/pagespeed specifically, this made
 * the feature permanently return "connect a key" even after connecting
 * one, confirmed via a direct DB read finding zero provider_connections
 * rows for an account that had a real key saved.
 */
export async function resolvePlatformApiKey(
  db: SupabaseClient,
  userId: string,
  key: "pagespeed_api_key" | "tavily_api_key" | "gemini_api_key",
): Promise<string | undefined> {
  // Hosted service credentials belong to the operator, never the customer.
  // The userId parameter is intentionally retained for call-site parity and
  // future per-tenant policy, but is not used to read a customer secret.
  void db;
  void userId;
  const envKey =
    key === "pagespeed_api_key" ? process.env.PAGESPEED_API_KEY : key === "gemini_api_key" ? process.env.GEMINI_API_KEY : process.env.TAVILY_API_KEY;
  return envKey?.trim() || undefined;
}
