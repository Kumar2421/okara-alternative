import { NextRequest, NextResponse } from "next/server";
import { createAction, getProjectAction, listProjectActions, transitionAction } from "@/lib/domain/actions/actionStore";
import { createAction as createActionSupabase, getProjectAction as getProjectActionSupabase, listProjectActions as listProjectActionsSupabase, transitionAction as transitionActionSupabase } from "@/lib/domain/actions/actionStoreSupabase";
import { isActionStatus, isActionType } from "@/lib/domain/actions/actionTypes";
import { deriveActionType } from "@/lib/domain/actions/deriveActionType";
import { getProjectFinding } from "@/lib/domain/findings/findingStore";
import { getProjectFinding as getProjectFindingSupabase } from "@/lib/domain/findings/findingStoreSupabase";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const findingId = req.nextUrl.searchParams.get("findingId") ?? undefined;
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
    return NextResponse.json({ actions: await listProjectActionsSupabase(db, user.id, projectId, findingId) });
  }
  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
  const action = id ? getProjectAction(projectId, id) : null;
  if (id) return action ? NextResponse.json({ action }) : NextResponse.json({ error: "Action not found." }, { status: 404 });
  return NextResponse.json({ actions: listProjectActions(projectId, findingId) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  // type is now optional: the server derives the right ActionType from the
  // finding itself (deriveActionType) so the client doesn't have to
  // duplicate that mapping or risk sending a mismatched one. An explicit
  // client-provided type is still honored if given.
  if (!body || typeof body.findingId !== "string" || typeof body.title !== "string") {
    return NextResponse.json({ error: "findingId and title are required." }, { status: 400 });
  }
  if (body.type !== undefined && !isActionType(body.type)) {
    return NextResponse.json({ error: "Invalid action type." }, { status: 400 });
  }
  const baseInput = {
    findingId: body.findingId as string,
    recommendationId: typeof body.recommendationId === "string" ? body.recommendationId : undefined,
    title: (body.title as string).trim(),
    target: body.target && typeof body.target === "object" ? body.target : {},
    parameters: body.parameters && typeof body.parameters === "object" ? body.parameters : {},
  };

  try {
    if (FEATURES.PLATFORM_MODE) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      const db = createServiceClient();
      const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
      const projectId = setting?.value;
      if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
      const finding = await getProjectFindingSupabase(db, user.id, projectId, baseInput.findingId);
      if (!finding) return NextResponse.json({ error: "Finding not found." }, { status: 404 });
      const type = isActionType(body.type) ? body.type : deriveActionType(finding);
      const action = await createActionSupabase(db, user.id, { projectId, type, ...baseInput });
      return NextResponse.json({ action }, { status: 201 });
    }
    const projectId = getActiveProjectId();
    if (!projectId) return NextResponse.json({ error: "No active project." }, { status: 422 });
    const finding = getProjectFinding(projectId, baseInput.findingId);
    if (!finding) return NextResponse.json({ error: "Finding not found." }, { status: 404 });
    const type = isActionType(body.type) ? body.type : deriveActionType(finding);
    return NextResponse.json({ action: createAction({ projectId, type, ...baseInput }) }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: message === "Finding not found." ? 404 : 500 });
  }
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
