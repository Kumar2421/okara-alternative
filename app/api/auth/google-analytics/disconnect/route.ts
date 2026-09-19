import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { deleteProjectIntegration } from "@/lib/domain/integrations/integrationStore";
import { deleteProjectIntegration as deleteProjectIntegrationSupabase } from "@/lib/domain/integrations/integrationStoreSupabase";

export async function POST() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { data: setting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const projectId = setting?.value;
    if (!projectId) return NextResponse.json({ error: "No active project" }, { status: 422 });

    await Promise.all([
      deleteProjectIntegrationSupabase(db, user.id, projectId, "google-search-console"),
      deleteProjectIntegrationSupabase(db, user.id, projectId, "google-analytics"),
    ]);

    return NextResponse.json({ success: true, projectId });
  }

  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ error: "No active project" }, { status: 422 });

  deleteProjectIntegration(projectId, "google-search-console");
  deleteProjectIntegration(projectId, "google-analytics");

  return NextResponse.json({ success: true, projectId });
}
