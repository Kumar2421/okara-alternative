import { NextResponse } from "next/server";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { listProjectIntegrations } from "@/lib/domain/integrations/integrationStore";
import { listProjectIntegrations as listProjectIntegrationsSupabase } from "@/lib/domain/integrations/integrationStoreSupabase";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function GET() {
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
    if (!projectId) return NextResponse.json({ projectId: null, integrations: [] });

    return NextResponse.json({ projectId, integrations: await listProjectIntegrationsSupabase(db, user.id, projectId) });
  }

  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ projectId: null, integrations: [] });
  return NextResponse.json({ projectId, integrations: listProjectIntegrations(projectId) });
}
