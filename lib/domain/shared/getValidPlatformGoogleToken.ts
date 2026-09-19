import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshAccessToken } from "./googleAnalyticsOAuth";
import {
  getProjectIntegration,
  getIntegrationSecrets,
  saveIntegrationSecrets,
} from "@/lib/domain/integrations/integrationStoreSupabase";

const EXPIRY_SKEW_MS = 60_000;

/** Platform-mode mirror of googleAnalyticsData.ts's internal
 * getValidAccessToken() (self-host) — same project-scoped connection
 * lookup, same "try GSC row or GA4 row, either carries the same token"
 * reasoning, refreshing via the shared refreshAccessToken() when stale and
 * persisting the refreshed token back through the Vault-backed adapter. */
export async function getValidPlatformGoogleToken(
  db: SupabaseClient,
  userId: string,
  projectId: string
): Promise<string> {
  const integration =
    (await getProjectIntegration(db, userId, projectId, "google-search-console")) ??
    (await getProjectIntegration(db, userId, projectId, "google-analytics"));
  if (!integration) {
    throw new Error("Google Analytics / Search Console isn't connected for this project — connect it in Settings → API Credentials.");
  }

  const secrets = await getIntegrationSecrets(db, userId, integration.id);
  if (!secrets?.refreshToken) {
    throw new Error("Google Analytics / Search Console credentials are incomplete — reconnect this project.");
  }

  if (secrets.accessToken && Date.now() < secrets.expiresAt - EXPIRY_SKEW_MS) {
    return secrets.accessToken;
  }

  const refreshed = await refreshAccessToken(secrets.refreshToken);
  await saveIntegrationSecrets(db, userId, integration.id, {
    accessToken: refreshed.accessToken,
    refreshToken: secrets.refreshToken,
    expiresAt: refreshed.expiresAt,
  });
  return refreshed.accessToken;
}
