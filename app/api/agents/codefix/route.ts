import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

/** Real memory read for the SEO tab — which findings already have an open/
 * merged/rejected fix, so the UI doesn't show "Fix in code" for something
 * already handled. Pure read of `code_fixes` — no LLM call, so no credit
 * charge in platform mode. */
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
    const activeId = setting?.value;
    if (!activeId) return NextResponse.json({ fixes: [] });

    const { data: fixes, error } = await db
      .from("code_fixes")
      .select("issue_id, status, pr_url")
      .eq("project_id", activeId)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ fixes: fixes ?? [] });
  }

  const activeId = getActiveProjectId();
  if (!activeId) return NextResponse.json({ fixes: [] });

  const db = getDb();
  const fixes = db.prepare("SELECT issue_id, status, pr_url FROM code_fixes WHERE project_id = ?").all(activeId);
  return NextResponse.json({ fixes });
}
