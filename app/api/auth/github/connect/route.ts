import { CREDENTIALS_PATH } from "@/lib/settingsPaths";
import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/domain/shared/githubOAuth";
import { createOAuthState as createOAuthStateSupabase } from "@/lib/domain/integrations/oauthStateSupabase";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function GET(req: NextRequest) {
  const settingsUrl = `${req.nextUrl.origin}${CREDENTIALS_PATH}`;
  if (!FEATURES.PLATFORM_MODE) {
    return NextResponse.redirect(`${settingsUrl}?github_error=${encodeURIComponent("GitHub OAuth is available on hosted deployments; use the self-host token flow instead.")}`);
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${settingsUrl}?github_error=${encodeURIComponent("Not authenticated")}`);

  try {
    const db = createServiceClient();
    const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
    if (!setting?.value) return NextResponse.redirect(`${settingsUrl}?github_error=${encodeURIComponent("Select or create a project before connecting GitHub.")}`);
    const state = await createOAuthStateSupabase(db, user.id, { projectId: setting.value, returnTo: "settings" });
    return NextResponse.redirect(buildAuthUrl(`${req.nextUrl.origin}/api/auth/github/callback`, state));
  } catch (err) {
    return NextResponse.redirect(`${settingsUrl}?github_error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
  }
}
