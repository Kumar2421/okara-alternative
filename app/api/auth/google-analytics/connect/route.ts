import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/domain/shared/googleAnalyticsOAuth";
import { createOAuthState } from "@/lib/domain/integrations/oauthState";
import { createOAuthState as createOAuthStateSupabase } from "@/lib/domain/integrations/oauthStateSupabase";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function GET(req: NextRequest) {
  const redirectUri = req.nextUrl.origin + "/api/auth/google-analytics/callback";
  const returnTo = req.nextUrl.searchParams.get("return") === "dashboard" ? "dashboard" : "settings";
  const errorRedirect = (message: string) =>
    NextResponse.redirect(req.nextUrl.origin + "/settings/api-credentials?ga_error=" + encodeURIComponent(message));

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return errorRedirect("Not authenticated");

    const db = createServiceClient();
    const projectId =
      req.nextUrl.searchParams.get("project") ||
      (
        await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle()
      ).data?.value;
    if (!projectId) return errorRedirect("Select or create a project before connecting Google.");

    try {
      const state = await createOAuthStateSupabase(db, user.id, { projectId, returnTo });
      return NextResponse.redirect(buildAuthUrl(redirectUri, state));
    } catch (err) {
      return errorRedirect(err instanceof Error ? err.message : String(err));
    }
  }

  const projectId = req.nextUrl.searchParams.get("project") || getActiveProjectId();
  if (!projectId) {
    return errorRedirect("Select or create a project before connecting Google.");
  }

  try {
    const state = createOAuthState({ projectId, returnTo });
    return NextResponse.redirect(buildAuthUrl(redirectUri, state));
  } catch (err) {
    return errorRedirect(err instanceof Error ? err.message : String(err));
  }
}
