import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { redactSettingsForClient } from "@/lib/domain/shared/settingsRedaction";

/** Generic per-user KV settings (primaryModel, non-secret preferences) — the
 * platform-mode analogue of the SQLite `settings` table. OAuth tokens never
 * live here in platform mode; they're stored via Vault behind
 * integration_connections (see the auth/* callback/disconnect routes and
 * settings/google-cloud/create-key/route.ts). This set is the exact keys
 * those routes used to write into the shared `settings` table — reject them
 * here so a generic KV write never becomes a plaintext-token write. */
const OAUTH_TOKEN_KEYS = new Set([
  "gmail_access_token",
  "gmail_refresh_token",
  "ga_access_token",
  "ga_refresh_token",
  "gcp_access_token",
  "gcp_refresh_token",
  "google_cloud_api_key",
]);

/** Reconstructs the legacy flat key/value shape the Settings UI expects from
 * the platform-mode integration_connections rows, so the frontend (out of
 * scope for this pass) keeps working unchanged. Token presence is shown as a
 * fixed masked placeholder — the real value is never decrypted just to
 * render a connected/disconnected indicator. */
async function integrationSettingsAsLegacyRows(
  db: ReturnType<typeof createServiceClient>,
  userId: string
): Promise<{ key: string; value: string }[]> {
  const { data: rows } = await db
    .from("integration_connections")
    .select("provider, external_email, external_property, access_token_secret_id, refresh_token_secret_id")
    .eq("user_id", userId);

  const out: { key: string; value: string }[] = [];
  const placeholder = "••••••";

  for (const row of rows ?? []) {
    if (row.provider === "gmail") {
      if (row.access_token_secret_id) out.push({ key: "gmail_access_token", value: placeholder });
      if (row.refresh_token_secret_id) out.push({ key: "gmail_refresh_token", value: placeholder });
      if (row.external_email) out.push({ key: "gmail_email", value: row.external_email });
    } else if (row.provider === "ga4") {
      if (row.access_token_secret_id) out.push({ key: "ga_access_token", value: placeholder });
      if (row.refresh_token_secret_id) out.push({ key: "ga_refresh_token", value: placeholder });
      if (row.external_email) out.push({ key: "ga_email", value: row.external_email });
      // external_property is packed as "id::name" — see auth/callback and
      // auth/google-analytics/callback for the writer side.
      const [propId, propName] = (row.external_property ?? "").split("::");
      if (propId) out.push({ key: "ga_property_id", value: propId });
      if (propName) out.push({ key: "ga_property_name", value: propName });
    } else if (row.provider === "gsc") {
      if (row.external_property) out.push({ key: "gsc_site_url", value: row.external_property });
    } else if (row.provider === "gcp") {
      if (row.access_token_secret_id) out.push({ key: "gcp_access_token", value: placeholder });
      if (row.refresh_token_secret_id) out.push({ key: "gcp_refresh_token", value: placeholder });
      if (row.external_email) out.push({ key: "gcp_email", value: row.external_email });
      if (row.external_property) out.push({ key: "gcp_project_id", value: row.external_property });
    }
  }

  const { data: keySetting } = await db
    .from("user_settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", "google_cloud_api_key_secret_id")
    .maybeSingle();
  if (keySetting?.value) out.push({ key: "google_cloud_api_key", value: placeholder });

  return out;
}

export async function GET(req: NextRequest) {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    try {
      const db = createServiceClient();
      const { data: genericRows, error } = await db
        .from("user_settings")
        .select("key, value")
        .eq("user_id", user.id)
        .neq("key", "google_cloud_api_key_secret_id"); // internal pointer, not user-facing
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      const integrationRows = await integrationSettingsAsLegacyRows(db, user.id);
      const settings = [...(genericRows ?? []), ...integrationRows];
      return NextResponse.json({ settings: redactSettingsForClient(settings) });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: raw }, { status: 500 });
    }
  }

  try {
    const db = getDb();
    const settings = db.prepare("SELECT * FROM settings").all() as { key: string; value: string }[];
    return NextResponse.json({ settings: redactSettingsForClient(settings) });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { key, value } = body;
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

  if (FEATURES.PLATFORM_MODE) {
    if (OAUTH_TOKEN_KEYS.has(key)) {
      // These only ever get written by the dedicated OAuth callback / key
      // creation routes, which route them through Vault. Accepting them here
      // would mean a raw token landing in a plaintext user_settings.value
      // column.
      return NextResponse.json(
        { error: `"${key}" is managed by its integration's connect flow, not by generic settings.` },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    try {
      const db = createServiceClient();
      const { error } = await db.from("user_settings").upsert(
        { user_id: user.id, key, value: String(value ?? ""), updated_at: new Date().toISOString() },
        { onConflict: "user_id,key" }
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: raw }, { status: 500 });
    }
  }

  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
    return NextResponse.json({ success: true });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
