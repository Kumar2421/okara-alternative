import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isAutomationMode } from "@/lib/domain/actions/automationSettings";
import { getAutomationSettings, saveAutomationSettings } from "@/lib/domain/actions/automationSettingsStore";
import {
  getAutomationSettings as getAutomationSettingsSupabase,
  saveAutomationSettings as saveAutomationSettingsSupabase,
} from "@/lib/domain/actions/automationSettingsStoreSupabase";
import { getAuthenticatedProjectContext } from "@/lib/domain/shared/project-context";

/** The project's automation setting. Off ("Ask me") unless the user turned it on. */
export async function GET() {
  const auth = await getAuthenticatedProjectContext();
  if ("response" in auth) return auth.response;
  const { userId, projectId, supabase } = auth.context;
  const settings = supabase && userId ? await getAutomationSettingsSupabase(supabase, userId, projectId) : getAutomationSettings(getDb(), projectId);
  return NextResponse.json({ settings });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!isAutomationMode(body?.mode)) return NextResponse.json({ error: "mode must be \"off\" or \"auto_approve_safe\"." }, { status: 400 });
  const auth = await getAuthenticatedProjectContext();
  if ("response" in auth) return auth.response;
  const { userId, projectId, supabase } = auth.context;

  try {
    const next = { mode: body.mode, updatedAt: null };
    const settings = supabase && userId
      ? await saveAutomationSettingsSupabase(supabase, userId, projectId, next)
      : saveAutomationSettings(getDb(), projectId, next);
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save the setting." }, { status: 500 });
  }
}
