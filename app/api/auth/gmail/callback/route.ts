import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { consumeOAuthState } from "@/lib/domain/integrations/oauthState";
import { consumeOAuthState as consumeOAuthStateSupabase } from "@/lib/domain/integrations/oauthStateSupabase";
import { exchangeCodeForTokens, getConnectedEmail } from "@/lib/domain/shared/gmailOAuth";

function upsertSetting(db: ReturnType<typeof getDb>, key: string, value: string) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const redirectUri = `${req.nextUrl.origin}/api/auth/gmail/callback`;
  const settingsUrl = `${req.nextUrl.origin}/settings/api-credentials`;

  if (!code || !state) {
    return NextResponse.redirect(`${settingsUrl}?gmail_error=${encodeURIComponent("No authorization code returned")}`);
  }

  try {
    let platformUserId: string | null = null;
    if (FEATURES.PLATFORM_MODE) {
      return NextResponse.redirect(settingsUrl + "?gmail_error=" + encodeURIComponent("Hosted Gmail uses the platform Google sign-in. Please reconnect with Google."));
    }

    if (FEATURES.PLATFORM_MODE) {
      const oauthState = await consumeOAuthStateSupabase(createServiceClient(), state);
      if (!oauthState) return NextResponse.redirect(`${settingsUrl}?gmail_error=${encodeURIComponent("Gmail authorization expired or was already used. Please reconnect.")}`);
      platformUserId = oauthState.userId;
    } else {
      const oauthState = consumeOAuthState(state);
      if (!oauthState) return NextResponse.redirect(`${settingsUrl}?gmail_error=${encodeURIComponent("Gmail authorization expired or was already used. Please reconnect.")}`);
    }
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
      const db = createServiceClient();
      const [{ data: accessSecretId, error: accessErr }, { data: refreshSecretId, error: refreshErr }] =
        await Promise.all([
          db.rpc("vault_set_secret", { p_secret: tokens.accessToken, p_name: `gmail_token:${platformUserId as string}:access` }),
          db.rpc("vault_set_secret", { p_secret: tokens.refreshToken, p_name: `gmail_token:${platformUserId as string}:refresh` }),
        ]);
      if (accessErr || refreshErr) {
        const raw = accessErr?.message ?? refreshErr?.message ?? "Failed to store token in Vault";
        return NextResponse.redirect(`${settingsUrl}?gmail_error=${encodeURIComponent(raw)}`);
      }

      const { error } = await db.from("integration_connections").upsert(
        {
          user_id: platformUserId as string,
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
