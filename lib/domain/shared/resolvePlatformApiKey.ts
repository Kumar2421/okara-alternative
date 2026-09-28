import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * BYOK third-party API keys (PageSpeed, Tavily) are saved through the
 * generic Settings UI (PageSpeedCard.tsx, TavilyCard.tsx -> POST
 * /api/settings), which writes them into user_settings -- a plain
 * per-user key/value row, not Vault-backed, same as self-host's SQLite
 * `settings` table. They are NOT provider_connections rows (that table is
 * for real OAuth-connected providers: gmail, ga4, gsc, gcp, github).
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
  key: "pagespeed_api_key" | "tavily_api_key",
): Promise<string | undefined> {
  const { data } = await db.from("user_settings").select("value").eq("user_id", userId).eq("key", key).maybeSingle();
  return data?.value || undefined;
}
