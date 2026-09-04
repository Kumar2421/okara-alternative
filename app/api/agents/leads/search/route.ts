import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { LeadsAgent } from "@/lib/domain/leads/LeadsAgent";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

export async function GET() {
  const activeId = getActiveProjectId();
  if (!activeId) return NextResponse.json({ leads: [] });

  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM leads WHERE project_id = ? ORDER BY created_at DESC")
    .all(activeId);

  return NextResponse.json({ leads: rows });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const role: string = typeof body?.role === "string" ? body.role.trim() : "";
  const companyOrIndustry: string = typeof body?.companyOrIndustry === "string" ? body.companyOrIndustry.trim() : "";
  const location: string = typeof body?.location === "string" ? body.location.trim() : "";
  const providerId: string | undefined = body?.providerId;
  const model: string | undefined = body?.model;

  if (!role && !companyOrIndustry) {
    return NextResponse.json({ error: "Enter at least a role or a company/industry to search for." }, { status: 400 });
  }
  if (!model || !providerId) {
    return NextResponse.json(
      { error: "No model selected. Connect a provider in Settings → LLM Providers." },
      { status: 422 }
    );
  }

  const driver = getDriver(providerId);
  if (!driver) {
    return NextResponse.json({ error: `${providerId} isn't wired to a real model yet.` }, { status: 501 });
  }

  const db = getDb();

  const tavilyKeyRow = db.prepare("SELECT value FROM settings WHERE key = 'tavily_api_key'").get() as
    | { value: string }
    | undefined;
  if (!tavilyKeyRow?.value) {
    return NextResponse.json(
      { error: "Connect a Tavily API key in Settings → LLM Providers to search for real leads." },
      { status: 422 }
    );
  }

  const keyRow = db
    .prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?")
    .get(providerId) as { api_key: string; base_url: string | null } | undefined;
  if (!keyRow) {
    return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });
  }

  const activeId = getActiveProjectId();
  if (!activeId) {
    return NextResponse.json({ error: "No active project. Link a website first." }, { status: 422 });
  }

  try {
    const agent = new LeadsAgent(driver, keyRow.api_key, keyRow.base_url ?? undefined);
    const query = `${role} ${companyOrIndustry} ${location}`.trim();
    const leads = await agent.search({ role, companyOrIndustry, location }, tavilyKeyRow.value, model);

    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO leads (id, project_id, name, title, company, location, email, source_url, query, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const saved = leads.map((lead) => {
      const id = `lead_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      insert.run(id, activeId, lead.name, lead.title, lead.company, lead.location, lead.email, lead.sourceUrl, query, now);
      return { id, project_id: activeId, ...lead, query, created_at: now };
    });

    return NextResponse.json({ leads: saved });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param is required" }, { status: 400 });

  const db = getDb();
  db.prepare("DELETE FROM leads WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
