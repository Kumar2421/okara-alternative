import { NextRequest, NextResponse } from "next/server";
import { consumeOAuthState as consumeOAuthStateSupabase } from "@/lib/domain/integrations/oauthStateSupabase";
import { exchangeCodeForToken, getGitHubUser } from "@/lib/domain/shared/githubOAuth";
import { FEATURES } from "@/lib/features";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function GET(req: NextRequest) {
  const settingsUrl = `${req.nextUrl.origin}/settings/api-credentials`;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) return NextResponse.redirect(`${settingsUrl}?github_error=${encodeURIComponent("No authorization code returned")}`);
  if (!FEATURES.PLATFORM_MODE) return NextResponse.redirect(`${settingsUrl}?github_error=${encodeURIComponent("GitHub OAuth is hosted-mode only.")}`);

  try {
    const db = createServiceClient();
    const oauthState = await consumeOAuthStateSupabase(db, state);
    if (!oauthState) return NextResponse.redirect(`${settingsUrl}?github_error=${encodeURIComponent("GitHub authorization expired or was already used. Please reconnect.")}`);

    const tokens = await exchangeCodeForToken(code, `${req.nextUrl.origin}/api/auth/github/callback`);
    const profile = await getGitHubUser(tokens.accessToken);
    const { data: secretId, error: secretError } = await db.rpc("vault_set_secret", {
      p_secret: tokens.accessToken,
      p_name: `github_token:${oauthState.userId}`,
    });
    if (secretError) throw new Error(secretError.message);

    const { error } = await db.from("provider_connections").upsert({
      user_id: oauthState.userId,
      provider_id: "github",
      base_url: null,
      key_preview: "oauth",
      api_key_secret_id: secretId as string,
      connected_at: new Date().toISOString(),
    }, { onConflict: "user_id,provider_id" });
    if (error) throw new Error(error.message);

    return NextResponse.redirect(settingsUrl);
  } catch (err) {
    return NextResponse.redirect(`${settingsUrl}?github_error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
  }
}
