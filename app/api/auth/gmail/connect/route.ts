import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/domain/shared/gmailOAuth";
import { createOAuthState } from "@/lib/domain/integrations/oauthState";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";

export async function GET(req: NextRequest) {
  const redirectUri = `${req.nextUrl.origin}/api/auth/gmail/callback`;
  const settingsUrl = `${req.nextUrl.origin}/settings/api-credentials`;

  try {
    if (FEATURES.PLATFORM_MODE) {
      return NextResponse.redirect(`${req.nextUrl.origin}/settings/api-credentials?gmail_error=${encodeURIComponent("Hosted Gmail uses the platform Google sign-in. Use Connect with Google.")}`);
    }

    const projectId = getActiveProjectId();
    if (!projectId) return NextResponse.redirect(`${settingsUrl}?gmail_error=${encodeURIComponent("Select or create a project before connecting Gmail.")}`);
    const state = createOAuthState({ projectId, returnTo: "settings" });
    return NextResponse.redirect(buildAuthUrl(redirectUri, state));
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(`${settingsUrl}?gmail_error=${encodeURIComponent(raw)}`);
  }
}
