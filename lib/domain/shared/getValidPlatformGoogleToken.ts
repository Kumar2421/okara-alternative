import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshAccessToken } from "./googleAnalyticsOAuth";

const EXPIRY_SKEW_MS = 60_000;

const LABELS: Record<"ga4" | "gsc", string> = {
  ga4: "Google Analytics",
  gsc: "Search Console",
};

/** Platform-mode equivalent of getValidAccessToken() (lib/domain/analytics/googleAnalyticsData.ts)
 * for one user's GA4 or Search Console connection — decrypts the stored
 * access token from Vault, refreshing it first (via the same
 * refreshAccessToken() self-host uses) when it's expired or close to it,
 * and persists the refreshed token back to integration_connections so the
 * next call skips the refresh round-trip. */
export async function getValidPlatformGoogleToken(
  db: SupabaseClient,
  userId: string,
  provider: "ga4" | "gsc"
): Promise<string> {
  const { data: conn } = await db
    .from("integration_connections")
    .select("access_token_secret_id, refresh_token_secret_id, token_expiry")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  if (!conn?.access_token_secret_id) {
    throw new Error(`${LABELS[provider]} isn't connected — connect it in Settings → Integrations.`);
  }

  const expiresAt = conn.token_expiry ? new Date(conn.token_expiry).getTime() : 0;
  if (Date.now() < expiresAt - EXPIRY_SKEW_MS) {
    const { data: secret, error } = await db.rpc("vault_get_secret", { p_id: conn.access_token_secret_id });
    if (error || !secret) throw new Error(`${LABELS[provider]} token isn't available — reconnect in Settings.`);
    return secret as string;
  }

  if (!conn.refresh_token_secret_id) {
    throw new Error(`${LABELS[provider]} token expired and no refresh token is stored — reconnect in Settings.`);
  }
  const { data: refreshSecret, error: refreshErr } = await db.rpc("vault_get_secret", { p_id: conn.refresh_token_secret_id });
  if (refreshErr || !refreshSecret) throw new Error(`${LABELS[provider]} refresh token isn't available — reconnect in Settings.`);

  const refreshed = await refreshAccessToken(refreshSecret as string);

  // Same secret name the OAuth callback used to create it (`<provider>_token:<user>:access`)
  // — vault_set_secret updates that existing secret in place rather than creating a new one.
  const { data: newSecretId, error: setErr } = await db.rpc("vault_set_secret", {
    p_secret: refreshed.accessToken,
    p_name: `${provider}_token:${userId}:access`,
  });
  if (setErr) throw new Error(setErr.message);

  await db
    .from("integration_connections")
    .update({
      access_token_secret_id: newSecretId,
      token_expiry: new Date(refreshed.expiresAt).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", provider);

  return refreshed.accessToken;
}
