import { NextRequest, NextResponse } from "next/server";
import { createAction, getProjectAction, listProjectActions, transitionAction } from "@/lib/domain/actions/actionStore";
import { createAction as createActionSupabase, getProjectAction as getProjectActionSupabase, listProjectActions as listProjectActionsSupabase, transitionAction as transitionActionSupabase } from "@/lib/domain/actions/actionStoreSupabase";
import { isActionStatus, isActionType } from "@/lib/domain/actions/actionTypes";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = createServiceClient();
    const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
    const projectId = setting?.value;
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
    const action = id ? await getProjectActionSupabase(db, user.id, projectId, id) : null;
    if (id) return action ? NextResponse.json({ action }) : NextResponse.json({ error: "Action not found." }, { status: 404 });
    return NextResponse.json({ actions: await listProjectActionsSupabase(db, user.id, projectId) });
  }
  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
  const action = id ? getProjectAction(projectId, id) : null;
  if (id) return action ? NextResponse.json({ action }) : NextResponse.json({ error: "Action not found." }, { status: 404 });
  return NextResponse.json({ actions: listProjectActions(projectId) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.findingId !== "string" || !isActionType(body.type) || typeof body.title !== "string") {
    return NextResponse.json({ error: "findingId, type, and title are required." }, { status: 400 });
  }
  const input = {
    findingId: body.findingId,
    recommendationId: typeof body.recommendationId === "string" ? body.recommendationId : undefined,
    type: body.type,
    title: body.title.trim(),
    target: body.target && typeof body.target === "object" ? body.target : {},
    parameters: body.parameters && typeof body.parameters === "object" ? body.parameters : {},
  };
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = createServiceClient();
    const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
    const projectId = setting?.value;
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
    const action = await createActionSupabase(db, user.id, { projectId, ...input });
    return NextResponse.json({ action }, { status: 201 });
  }
  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
  return NextResponse.json({ action: createAction({ projectId, ...input }) }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (typeof body?.id !== "string" || !isActionStatus(body?.status)) return NextResponse.json({ error: "id and valid status are required." }, { status: 400 });
  try {
    if (FEATURES.PLATFORM_MODE) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      const db = createServiceClient();
      const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
      const projectId = setting?.value;
      if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
      const action = await transitionActionSupabase(db, user.id, projectId, body.id, body.status, body.result ?? null);
      return action ? NextResponse.json({ action }) : NextResponse.json({ error: "Action not found." }, { status: 404 });
    }
    const projectId = getActiveProjectId();
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
    const action = transitionAction(projectId, body.id, body.status, body.result ?? null);
    return action ? NextResponse.json({ action }) : NextResponse.json({ error: "Action not found." }, { status: 404 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: message.startsWith("Invalid action status transition") ? 409 : 502 });
  }
}
