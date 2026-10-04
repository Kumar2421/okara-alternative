import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { generateAutoLeads } from "@/lib/domain/leads/autoGenerateLeads";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

const CREATION_LIMIT = 10;

/**
 * Free, platform-only lead-generation baseline — called once right after a
 * new project's crawl succeeds (same place generate-description and
 * competitor discovery already run from). Self-host has no equivalent: this
 * is a hosted-plan convenience, not a self-host feature, so it 404s there
 * rather than silently doing nothing — project-store.tsx's caller only
 * invokes this route in platform mode to begin with.
 *
 * The daily refresh (5 new leads/day) is a separate cron route
 * (app/api/cron/leads-refresh/route.ts) that calls the same
 * autoGenerateLeads() helper — this route only covers the one-time
 * creation-time batch.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!FEATURES.PLATFORM_MODE) {
    return NextResponse.json({ error: "Not available in self-host mode." }, { status: 404 });
  }

  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = createServiceClient();
  const { data: project, error: projectError } = await db
    .from("projects")
    .select("id, name, category")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (projectError) return NextResponse.json({ error: projectError.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "No project with that id" }, { status: 404 });

  const outcome = await generateAutoLeads(db, user.id, project, CREATION_LIMIT);

  const { error: updateError } = await db
    .from("projects")
    .update({ leads_auto_last_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", user.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ added: outcome.added, reason: outcome.reason, message: outcome.message });
}
