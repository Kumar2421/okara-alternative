import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
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
  if (map.gcp_access_token && Date.now() < expiresAt - 60_000) return map.gcp_access_token;

  const refreshed = await refreshAccessToken(map.gcp_refresh_token);
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    "gcp_access_token",
    refreshed.accessToken
  );
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    "gcp_token_expiry",
    String(refreshed.expiresAt)
  );
  return refreshed.accessToken;
}

/** Self-host only: hosted deployments use operator-managed Google Cloud credentials. */
export async function POST(req: NextRequest) {
  if (FEATURES.PLATFORM_MODE) {
    return NextResponse.json({ error: "Google Cloud API credentials are managed by the hosted platform." }, { status: 410 });
  }

  const body = await req.json().catch(() => null);
  const gcpProjectId: string | undefined = body?.gcpProjectId;
  if (!gcpProjectId?.trim()) {
    return NextResponse.json({ error: "GCP project id is required." }, { status: 400 });
  }

  try {
    const accessToken = await getValidGcpAccessToken();
    const keyString = await createRestrictedApiKey(
      accessToken,
      gcpProjectId.trim(),
      "okara-alternative (Places, Custom Search, Knowledge Graph)"
    );

    const db = getDb();
    for (const [key, value] of [
      ["google_cloud_api_key", keyString],
      ["gcp_project_id", gcpProjectId.trim()],
    ]) {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
    }

    return NextResponse.json({ keyPreview: `${keyString.slice(0, 4)}••••${keyString.slice(-2)}` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create API key." }, { status: 500 });
  }
}
