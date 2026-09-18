import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/domain/shared/googleAnalyticsOAuth";
import { createOAuthState } from "@/lib/domain/integrations/oauthState";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("project") || getActiveProjectId();
  if (!projectId) {
    return NextResponse.redirect(
      req.nextUrl.origin + "/settings/api-credentials?ga_error=" +
        encodeURIComponent("Select or create a project before connecting Google.")
    );
  }

  const redirectUri = req.nextUrl.origin + "/api/auth/google-analytics/callback";
  const returnTo = req.nextUrl.searchParams.get("return") === "dashboard" ? "dashboard" : "settings";

  try {
    const state = createOAuthState({ projectId, returnTo });
    return NextResponse.redirect(buildAuthUrl(redirectUri, state));
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      req.nextUrl.origin + "/settings/api-credentials?ga_error=" + encodeURIComponent(raw)
    );
  }
}
