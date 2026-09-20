import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { FEATURES } from "@/lib/features";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { getDb } from "@/lib/db";

export type ProjectContext = {
  userId: string | null;
  projectId: string;
  project: Record<string, unknown>;
  supabase?: ReturnType<typeof createServiceClient>;
};

export async function getAuthenticatedProjectContext(
  requestedProjectId?: string | null
): Promise<{ context: ProjectContext } | { response: NextResponse }> {
  if (FEATURES.PLATFORM_MODE) {
    const authClient = await createClient();
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
    }

    const db = createServiceClient();
    let projectQuery = db
      .from("projects")
      .select("id, owner_id, name, category, description, url, created_at, updated_at")
      .eq("owner_id", user.id);

    const projectId = requestedProjectId ?? null;
    const { data: setting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const activeId = projectId ?? setting?.value ?? null;
    if (!activeId) {
      return { response: NextResponse.json({ error: "No active project" }, { status: 404 }) };
    }

    const { data: project, error } = await projectQuery.eq("id", activeId).maybeSingle();
    if (error) return { response: NextResponse.json({ error: error.message }, { status: 500 }) };
    if (!project) return { response: NextResponse.json({ error: "Project not found" }, { status: 404 }) };

    return { context: { userId: user.id, projectId: project.id, project, supabase: db } };
  }

  const db = getDb();
  const projectId = requestedProjectId ?? getActiveProjectId();
  if (!projectId) return { response: NextResponse.json({ error: "No active project" }, { status: 404 }) };
  const project = db.prepare("SELECT id, name, category, description, url, created_at, updated_at FROM projects WHERE id = ?").get(projectId) as Record<string, unknown> | undefined;
  if (!project) return { response: NextResponse.json({ error: "Project not found" }, { status: 404 }) };
  return { context: { userId: null, projectId, project } };
}
