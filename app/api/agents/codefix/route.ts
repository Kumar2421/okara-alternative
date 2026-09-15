import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

/** Real memory read for the SEO tab — which findings already have an open/
 * merged/rejected fix, so the UI doesn't show "Fix in code" for something
 * already handled. */
export async function GET() {
  const activeId = getActiveProjectId();
  if (!activeId) return NextResponse.json({ fixes: [] });

  const db = getDb();
  const fixes = db.prepare("SELECT issue_id, status, pr_url FROM code_fixes WHERE project_id = ?").all(activeId);
  return NextResponse.json({ fixes });
}
