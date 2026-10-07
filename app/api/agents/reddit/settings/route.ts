import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeRedditSettings } from "@/lib/domain/reddit/redditSettings";
import { getRedditSettings, saveRedditSettings } from "@/lib/domain/reddit/redditSettingsStore";
import {
  getRedditSettings as getRedditSettingsSupabase,
  saveRedditSettings as saveRedditSettingsSupabase,
} from "@/lib/domain/reddit/redditSettingsStoreSupabase";
import { getAuthenticatedProjectContext } from "@/lib/domain/shared/project-context";

export async function GET() {
  const auth = await getAuthenticatedProjectContext();
  if ("response" in auth) return auth.response;
  const { userId, projectId, supabase } = auth.context;
  const settings = supabase && userId ? await getRedditSettingsSupabase(supabase, userId, projectId) : getRedditSettings(getDb(), projectId);
  return NextResponse.json({ settings });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const auth = await getAuthenticatedProjectContext();
  if ("response" in auth) return auth.response;
  const { userId, projectId, supabase } = auth.context;

  const settings = normalizeRedditSettings((body as { settings?: unknown }).settings);
  try {
    if (supabase && userId) await saveRedditSettingsSupabase(supabase, userId, projectId, settings);
    else saveRedditSettings(getDb(), projectId, settings);
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save Reddit settings." }, { status: 500 });
  }
}
