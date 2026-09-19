import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { refreshAccessToken } from "@/lib/domain/shared/googleCloudOAuth";
import { createRestrictedApiKey } from "@/lib/domain/settings/googleCloudApiKeys";

async function getValidGcpAccessToken(): Promise<string> {
  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM settings WHERE key IN ('gcp_access_token', 'gcp_refresh_token', 'gcp_token_expiry')")
    .all() as { key: string; value: string }[];
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  if (!map.gcp_refresh_token) {
    throw new Error("Google Cloud isn't connected — connect it in Settings → API Credentials first.");
  }

  const expiresAt = Number(map.gcp_token_expiry ?? 0);
  if (map.gcp_access_token && Date.now() < expiresAt - 60_000) {
    return map.gcp_access_token;
  }

  const refreshed = await refreshAccessToken(map.gcp_refresh_token);
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
    "gcp_access_token",
    refreshed.accessToken
  );
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
    "gcp_token_expiry",
    String(refreshed.expiresAt)
  );
  return refreshed.accessToken;
}

/** Platform-mode equivalent: the GCP OAuth tokens live in Vault behind
 * integration_connections, not a plaintext settings row. Refreshes and
 * writes the (possibly new) access token back through Vault + the
 * connection row's token_expiry when it's stale. */
async function getValidGcpAccessTokenSupabase(
  db: ReturnType<typeof createServiceClient>,
  userId: string
): Promise<string> {
  const { data: conn, error } = await db
    .from("integration_connections")
    .select("access_token_secret_id, refresh_token_secret_id, token_expiry")
    .eq("user_id", userId)
    .eq("provider", "gcp")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!conn?.refresh_token_secret_id) {
    throw new Error("Google Cloud isn't connected — connect it in Settings → API Credentials first.");
  }

  const expiresAt = conn.token_expiry ? new Date(conn.token_expiry).getTime() : 0;
  if (conn.access_token_secret_id && Date.now() < expiresAt - 60_000) {
    const { data: accessToken, error: getErr } = await db.rpc("vault_get_secret", { p_id: conn.access_token_secret_id });
    if (getErr) throw new Error(getErr.message);
    return accessToken as string;
  }

  const { data: refreshToken, error: refreshGetErr } = await db.rpc("vault_get_secret", { p_id: conn.refresh_token_secret_id });
  if (refreshGetErr) throw new Error(refreshGetErr.message);

  const refreshed = await refreshAccessToken(refreshToken as string);

  const { data: newAccessSecretId, error: setErr } = await db.rpc("vault_set_secret", {
    p_secret: refreshed.accessToken,
    p_name: `gcp_token:${userId}:access`,
  });
  if (setErr) throw new Error(setErr.message);

  await db
    .from("integration_connections")
    .update({
      access_token_secret_id: newAccessSecretId as string,
      token_expiry: new Date(refreshed.expiresAt).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", "gcp");

  return refreshed.accessToken;
}

/** Real key creation — a fresh restricted API key is created on the caller's
 * own GCP project and saved directly into settings.google_cloud_api_key,
 * the same key PlacesAgent/googleSearch/knowledgeGraph already read. No
 * manual copy-paste needed once Google Cloud is connected. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const gcpProjectId: string | undefined = body?.gcpProjectId;
  if (!gcpProjectId?.trim()) {
    return NextResponse.json({ error: "GCP project id is required." }, { status: 400 });
  }

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    try {
      const db = createServiceClient();
      const accessToken = await getValidGcpAccessTokenSupabase(db, user.id);
      const keyString = await createRestrictedApiKey(accessToken, gcpProjectId.trim(), "okara-alternative (Places, Custom Search, Knowledge Graph)");

      // No dedicated column for this key on integration_connections — it's
      // stored in Vault like every other secret, and only the pointer (a
      // meaningless uuid without service-role vault access) is written to
      // user_settings.value, mirroring the *_secret_id indirection used
      // elsewhere.
      const { data: keySecretId, error: setErr } = await db.rpc("vault_set_secret", {
        p_secret: keyString,
        p_name: `gcp_api_key:${user.id}`,
      });
      if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 });

      const { error: upsertErr } = await db.from("user_settings").upsert(
        {
          user_id: user.id,
          key: "google_cloud_api_key_secret_id",
          value: keySecretId as string,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,key" }
      );
      if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });

      const { error: connErr } = await db
        .from("integration_connections")
        .update({ external_property: gcpProjectId.trim(), updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .eq("provider", "gcp");
      if (connErr) return NextResponse.json({ error: connErr.message }, { status: 500 });

      return NextResponse.json({ keyPreview: `${keyString.slice(0, 4)}••••${keyString.slice(-2)}` });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create API key." }, { status: 500 });
    }
  }

  try {
    const accessToken = await getValidGcpAccessToken();
    const keyString = await createRestrictedApiKey(accessToken, gcpProjectId.trim(), "okara-alternative (Places, Custom Search, Knowledge Graph)");

    const db = getDb();
    for (const [key, value] of [
      ["google_cloud_api_key", keyString],
      ["gcp_project_id", gcpProjectId.trim()],
    ]) {
      db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
    }

    return NextResponse.json({ keyPreview: `${keyString.slice(0, 4)}••••${keyString.slice(-2)}` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create API key." }, { status: 500 });
  }
}
