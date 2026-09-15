import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

/**
 * Agent query leads endpoint.
 * Takes natural language query, uses LLM to parse filters, returns matching leads.
 *
 * Example:
 * POST /api/agents/chat/query-leads
 * { query: "Find CTOs in NYC that raised Series A", model: "...", providerId: "..." }
 */

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const query: string = typeof body?.query === "string" ? body.query : "";
  const model: string = typeof body?.model === "string" ? body.model : "";
  const providerId: string = typeof body?.providerId === "string" ? body.providerId : "";

  if (!query.trim()) {
    return NextResponse.json({ error: "Query required" }, { status: 400 });
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

    // Use LLM to understand the query and suggest SQL filters
    const filterPrompt = `Parse this lead search query and suggest SQL WHERE conditions.
Query: "${query}"

Respond with JSON:
{
  "title": "what user searched for",
  "where_conditions": ["title LIKE '%CTO%'", "location = 'New York'"],
  "limit": 20,
  "explanation": "brief explanation of filters"
}

Only return valid SQLite conditions. If unclear, return empty where_conditions.`;

    const filterRes = await driver({
      apiKey: keyRow.api_key || "",
      model,
      baseUrl: keyRow.base_url || undefined,
      messages: [{ role: "user", content: filterPrompt }],
    });

    let filters: { where_conditions: string[]; limit: number } = {
      where_conditions: [],
      limit: 20,
    };

    try {
      const jsonMatch = filterRes.text?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        filters = {
          where_conditions: Array.isArray(parsed.where_conditions)
            ? parsed.where_conditions.slice(0, 5) // max 5 conditions
            : [],
          limit: Math.min(parsed.limit || 20, 50), // max 50 results
        };
      }
    } catch (e) {
      console.log("[query-leads] LLM filter parse error, using defaults");
    }

    // Build SQL query
    let sql = "SELECT id, name, title, company, email, location FROM leads WHERE project_id = ?";
    const params: any[] = [projectId];

    if (filters.where_conditions.length > 0) {
      sql += " AND (" + filters.where_conditions.join(" OR ") + ")";
    }

    sql += " LIMIT ?";
    params.push(filters.limit);

    console.log(
      "[query-leads] Built SQL:",
      sql.slice(0, 100),
      "with",
      filters.where_conditions.length,
      "filters"
    );

    const leads = db.prepare(sql).all(...params) as Array<{
      id: string;
      name: string;
      title: string;
      company: string;
      email: string | null;
      location: string;
    }>;

    return NextResponse.json({
      query,
      filters: filters.where_conditions,
      count: leads.length,
      leads,
    });
  } catch (err) {
    console.error("[query-leads] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to query leads" },
      { status: 500 }
    );
  }
}
