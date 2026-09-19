import { NextRequest, NextResponse } from "next/server";
import { getProjectFinding } from "@/lib/domain/findings/findingStore";
import { getProjectFinding as getProjectFindingSupabase } from "@/lib/domain/findings/findingStoreSupabase";
import { getFindingRecommendations } from "@/lib/domain/recommendations/recommendationService";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Finding id is required." }, { status: 400 });

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = createServiceClient();
    const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
    const projectId = setting?.value;
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
    const finding = await getProjectFindingSupabase(db, user.id, projectId, id);
    if (!finding) return NextResponse.json({ error: "Finding not found." }, { status: 404 });
    return NextResponse.json({ recommendations: getFindingRecommendations(finding) });
  }

  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
  const finding = getProjectFinding(projectId, id);
  if (!finding) return NextResponse.json({ error: "Finding not found." }, { status: 404 });
  return NextResponse.json({ recommendations: getFindingRecommendations(finding) });
}
