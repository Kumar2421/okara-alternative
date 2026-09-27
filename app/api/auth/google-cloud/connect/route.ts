import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/domain/shared/googleCloudOAuth";
import { createOAuthState } from "@/lib/domain/integrations/oauthState";
import { createOAuthState as createOAuthStateSupabase } from "@/lib/domain/integrations/oauthStateSupabase";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function GET(req: NextRequest) {
  const redirectUri = `${req.nextUrl.origin}/api/auth/google-cloud/callback`;
  const settingsUrl = `${req.nextUrl.origin}/settings/api-credentials`;
  try {
    if (FEATURES.PLATFORM_MODE) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.redirect(`${settingsUrl}?gcp_error=${encodeURIComponent("Not authenticated")}`);
      const db = createServiceClient();
      const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
      const projectId = setting?.value ?? null;
      if (!projectId) return NextResponse.redirect(`${settingsUrl}?gcp_error=${encodeURIComponent("Select or create a project before connecting Google Cloud.")}`);
      const state = await createOAuthStateSupabase(db, user.id, { projectId, returnTo: "settings" });
      return NextResponse.redirect(buildAuthUrl(redirectUri, state));
    }
    const projectId = getActiveProjectId();
    if (!projectId) return NextResponse.redirect(`${settingsUrl}?gcp_error=${encodeURIComponent("Select or create a project before connecting Google Cloud.")}`);
    const state = createOAuthState({ projectId, returnTo: "settings" });
    return NextResponse.redirect(buildAuthUrl(redirectUri, state));
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(`${settingsUrl}?gcp_error=${encodeURIComponent(raw)}`);
  }
}
