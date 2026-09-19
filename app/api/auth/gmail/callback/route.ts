import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { exchangeCodeForTokens, getConnectedEmail } from "@/lib/domain/shared/gmailOAuth";

function upsertSetting(db: ReturnType<typeof getDb>, key: string, value: string) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const redirectUri = `${req.nextUrl.origin}/api/auth/gmail/callback`;
  const settingsUrl = `${req.nextUrl.origin}/settings/api-credentials`;

  if (!code) {
    return NextResponse.redirect(`${settingsUrl}?gmail_error=${encodeURIComponent("No authorization code returned")}`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    if (!tokens.refreshToken) {
      // Google only returns a refresh_token on first-ever consent for this
      // app+account (prompt=consent should always force it, but report
      // honestly if it somehow didn't) — without one, sending later will
      // silently fail once the short-lived access token expires.
      return NextResponse.redirect(
        `${settingsUrl}?gmail_error=${encodeURIComponent("No refresh token returned — disconnect any prior grant for this app in your Google Account's Security settings, then reconnect.")}`
      );
    }

    const email = await getConnectedEmail(tokens.accessToken);

    if (FEATURES.PLATFORM_MODE) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.redirect(`${settingsUrl}?gmail_error=${encodeURIComponent("Not authenticated")}`);

      const db = createServiceClient();
      const [{ data: accessSecretId, error: accessErr }, { data: refreshSecretId, error: refreshErr }] =
        await Promise.all([
          db.rpc("vault_set_secret", { p_secret: tokens.accessToken, p_name: `gmail_token:${user.id}:access` }),
          db.rpc("vault_set_secret", { p_secret: tokens.refreshToken, p_name: `gmail_token:${user.id}:refresh` }),
        ]);
      if (accessErr || refreshErr) {
        const raw = accessErr?.message ?? refreshErr?.message ?? "Failed to store token in Vault";
        return NextResponse.redirect(`${settingsUrl}?gmail_error=${encodeURIComponent(raw)}`);
      }

      const { error } = await db.from("integration_connections").upsert(
        {
          user_id: user.id,
          project_id: null,
          provider: "gmail",
          access_token_secret_id: accessSecretId as string,
          refresh_token_secret_id: refreshSecretId as string,
          token_expiry: new Date(tokens.expiresAt).toISOString(),
          external_email: email ?? null,
          external_property: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,project_id,provider" }
      );
      if (error) return NextResponse.redirect(`${settingsUrl}?gmail_error=${encodeURIComponent(error.message)}`);

      return NextResponse.redirect(settingsUrl);
    }

    const db = getDb();
    upsertSetting(db, "gmail_access_token", tokens.accessToken);
    upsertSetting(db, "gmail_refresh_token", tokens.refreshToken);
    upsertSetting(db, "gmail_token_expiry", String(tokens.expiresAt));
    upsertSetting(db, "gmail_email", email ?? "");

    return NextResponse.redirect(settingsUrl);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(`${settingsUrl}?gmail_error=${encodeURIComponent(raw)}`);
  }
}
