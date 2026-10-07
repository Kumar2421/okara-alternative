import { NextResponse } from "next/server";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import type { GeoContext } from "./geoService";

/** Auth + active project for a GEO route, in either mode. */
export async function resolveGeoContext(): Promise<{ ctx: GeoContext } | { response: NextResponse }> {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
    const db = createServiceClient();
    const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
    const projectId = setting?.value as string | undefined;
    if (!projectId) return { response: NextResponse.json({ error: "No active project." }, { status: 422 }) };
    return { ctx: { mode: "platform", db, userId: user.id, projectId } };
  }
  const projectId = getActiveProjectId();
  if (!projectId) return { response: NextResponse.json({ error: "No active project." }, { status: 422 }) };
  return { ctx: { mode: "selfhost", projectId } };
}
