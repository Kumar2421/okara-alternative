import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

/**
 * Agent draft email endpoint.
 * Takes lead IDs and context, uses LLM to draft personalized email.
 *
 * Example:
 * POST /api/agents/chat/draft-email
 * {
 *   leadIds: ["lead1", "lead2"],
 *   context: "Software engineer at startup in SF",
 *   tone: "professional",
 *   model: "...",
 *   providerId: "..."
 * }
 */

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const leadIds: string[] = Array.isArray(body?.leadIds) ? body.leadIds : [];
  const context: string = typeof body?.context === "string" ? body.context : "";
  const tone: string = typeof body?.tone === "string" ? body.tone : "professional";
  const model: string = typeof body?.model === "string" ? body.model : "";
  const providerId: string = typeof body?.providerId === "string" ? body.providerId : "";

  if (leadIds.length === 0) {
    return NextResponse.json({ error: "No leads selected" }, { status: 400 });
  }
  if (!model || !providerId) {
    return NextResponse.json(
      { error: "Model and provider required" },
      { status: 422 }
    );
  }

  const projectId = getActiveProjectId();
  if (!projectId) {
    return NextResponse.json(
      { error: "No active project" },
      { status: 400 }
    );
  }

  try {
    const db = getDb();
    const driver = getDriver(providerId);
    if (!driver) {
      return NextResponse.json(
        { error: `${providerId} not configured` },
        { status: 422 }
      );
    }

    const keyRow = db
      .prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?")
      .get(providerId) as { api_key: string | null; base_url: string | null } | undefined;

    if (!keyRow || (!keyRow.api_key?.trim() && !keyRow.base_url?.trim())) {
      return NextResponse.json(
        { error: "LLM provider not connected" },
        { status: 422 }
      );
    }

    // Fetch first lead as example
    const placeholders = leadIds.slice(0, 3).map(() => "?").join(",");
    const leads = db
      .prepare(
        `SELECT id, name, title, company, email FROM leads WHERE id IN (${placeholders})`
      )
      .all(...leadIds.slice(0, 3)) as Array<{
      id: string;
      name: string;
      title: string;
      company: string;
      email: string | null;
    }>;

    if (leads.length === 0) {
      return NextResponse.json({ error: "Leads not found" }, { status: 404 });
    }

    // Use LLM to draft email template
    const draftPrompt = `Draft a ${tone} outreach email for these leads.

Context: ${context}

Sample leads:
${leads.map((l) => `- ${l.name}, ${l.title} at ${l.company}`).join("\n")}

Create an email template with merge tags {{name}}, {{company}}, {{title}}.
Make it personal but professional.

Respond with ONLY valid JSON:
{
  "subject": "email subject with {{tags}}",
  "body": "email body with {{tags}}"
}`;

    const draftRes = await driver({
      apiKey: keyRow.api_key || "",
      model,
      baseUrl: keyRow.base_url || undefined,
      messages: [{ role: "user", content: draftPrompt }],
    });

    let template = { subject: "", body: "" };

    try {
      const jsonMatch = draftRes.text?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        template = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.log("[draft-email] Template parse error");
      template = {
        subject: "Subject for {{company}}",
        body: "Hi {{name}},\n\nI came across your profile...",
      };
    }

    console.log("[draft-email] Drafted template for", leads.length, "leads");

    return NextResponse.json({
      leadCount: leadIds.length,
      sampleLeads: leads,
      template,
    });
  } catch (err) {
    console.error("[draft-email] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to draft email" },
      { status: 500 }
    );
  }
}
