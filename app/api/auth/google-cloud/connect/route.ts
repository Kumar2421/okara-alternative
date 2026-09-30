import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/domain/shared/googleCloudOAuth";
import { createOAuthState } from "@/lib/domain/integrations/oauthState";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";

export async function GET(req: NextRequest) {
  const redirectUri = `${req.nextUrl.origin}/api/auth/google-cloud/callback`;
  const settingsUrl = `${req.nextUrl.origin}/settings/api-credentials`;

  if (FEATURES.PLATFORM_MODE) {
    return NextResponse.redirect(settingsUrl + "?gcp_error=" + encodeURIComponent("Google Cloud credentials are managed by the hosted platform."));
  }

  try {
    const projectId = getActiveProjectId();
    if (!projectId) return NextResponse.redirect(`${settingsUrl}?gcp_error=${encodeURIComponent("Select or create a project before connecting Google Cloud.")}`);
    const state = createOAuthState({ projectId, returnTo: "settings" });
    return NextResponse.redirect(buildAuthUrl(redirectUri, state));
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(`${settingsUrl}?gcp_error=${encodeURIComponent(raw)}`);
  }
}
