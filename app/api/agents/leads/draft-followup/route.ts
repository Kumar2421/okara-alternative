import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { classifyAndDraftFollowUp } from "@/lib/domain/leads/replyAgent";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const leadId: string | undefined = body?.leadId;
  const model: string | undefined = body?.model;
  const providerId: string | undefined = body?.providerId;

  if (!leadId) return NextResponse.json({ error: "leadId is required" }, { status: 400 });
  if (!model || !providerId) return NextResponse.json({ error: "No model selected." }, { status: 422 });

  const db = getDb();
  const lead = db.prepare("SELECT id, name, last_reply_snippet FROM leads WHERE id = ?").get(leadId) as
    | { id: string; name: string; last_reply_snippet: string | null }
    | undefined;
  if (!lead?.last_reply_snippet) {
    return NextResponse.json({ error: "This lead has no real reply to draft a follow-up from." }, { status: 422 });
  }

  const activeId = getActiveProjectId();
  const project = activeId ? (db.prepare("SELECT name FROM projects WHERE id = ?").get(activeId) as { name: string } | undefined) : undefined;

  const driver = getDriver(providerId);
  if (!driver) return NextResponse.json({ error: `${providerId} isn't wired to a real model yet.` }, { status: 501 });
  const connRow = db.prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?").get(providerId) as
    | { api_key: string; base_url: string | null }
    | undefined;
  if (!connRow) return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });

  try {
    const draft = await classifyAndDraftFollowUp(
      driver,
      connRow.api_key,
      model,
      project?.name ?? "this product",
      lead.name,
      lead.last_reply_snippet,
      connRow.base_url ?? undefined
    );
    return NextResponse.json(draft);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to draft a follow-up." }, { status: 500 });
  }
}
