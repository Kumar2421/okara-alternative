import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { generateCompetitorComparison } from "@/lib/domain/documents/CompetitorComparisonGenerator";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";


export async function GET() {
  try {
    const projectId = getActiveProjectId();
    if (!projectId) return NextResponse.json({ document: null });

    const db = getDb();
    const row = db
      .prepare("SELECT content FROM project_documents WHERE project_id = ? AND doc_type = 'competitor_comparison'")
      .get(projectId) as { content: string } | undefined;

    console.log(`[competitor-comparison GET] projectId=${projectId}, found=${!!row}, length=${row?.content.length || 0}`);
    if (row) {
      console.log(`[competitor-comparison GET] First 500 chars:\n${row.content.substring(0, 500)}`);
      console.log(`[competitor-comparison GET] Contains ### sections: ${(row.content.match(/###/g) || []).length}`);
    }

    return NextResponse.json({
      document: row ? { content: row.content } : null,
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to fetch comparison" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { model, providerId } = body ?? {};

  if (!model || !providerId) {
    return NextResponse.json(
      { error: "model and providerId required" },
      { status: 400 }
    );
  }

  try {
    const projectId = getActiveProjectId();
    if (!projectId) {
      return NextResponse.json({ error: "No active project" }, { status: 400 });
    }

    const db = getDb();

    // Fetch all competitors for this project
    const competitors = db
      .prepare("SELECT id, url FROM project_competitors WHERE project_id = ?")
      .all(projectId) as { id: string; url: string }[];

    console.log(`[competitor-comparison POST] Found ${competitors.length} competitors for project ${projectId}:`, competitors.map(c => c.url));

    if (competitors.length === 0) {
      return NextResponse.json({
        error: "No competitors added yet. Add at least one in the Context panel first.",
      }, { status: 400 });
    }

    // Get driver + API key for this provider
    const driver = getDriver(providerId);
    if (!driver) {
      return NextResponse.json({ error: `${providerId} isn't wired yet.` }, { status: 400 });
    }

    const keyRow = db
      .prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?")
      .get(providerId) as { api_key: string | null; base_url: string | null } | undefined;

    console.log(`[competitor-comparison] Provider ${providerId}: keyRow=${!!keyRow}, api_key=${keyRow?.api_key ? "present" : "empty/null"}, base_url=${keyRow?.base_url || "null"}`);

    if (!keyRow || (!keyRow.api_key?.trim() && !keyRow.base_url?.trim())) {
      return NextResponse.json({
        error: `${providerId} isn't properly connected. Check Settings → LLM Providers to add your API key or base URL.`
      }, { status: 422 });
    }



    // Generate comparison data
    const result = await generateCompetitorComparison(
      competitors,
      model,
      driver,
      keyRow.api_key || "",
      keyRow.base_url || undefined
    );

    // Convert to markdown for display
    const markdown = comparisonToMarkdown(result);
    console.log(`[competitor-comparison] Generated markdown (${markdown.length} chars):`);
    console.log(`[competitor-comparison] First 1000 chars:\n${markdown.substring(0, 1000)}`);
    console.log(`[competitor-comparison] Result contains ${result.competitors.length} competitors`);

    // Save to DB
    const stmt = db.prepare(`
      INSERT INTO project_documents (project_id, doc_type, content, status, created_at, updated_at)
      VALUES (?, 'competitor_comparison', ?, 'ready', datetime('now'), datetime('now'))
      ON CONFLICT(project_id, doc_type) DO UPDATE SET
        content = excluded.content,
        status = 'ready',
        updated_at = datetime('now')
    `);
    stmt.run(projectId, markdown);

    // Verify save
    const saved = db.prepare("SELECT content FROM project_documents WHERE project_id = ? AND doc_type = 'competitor_comparison'").get(projectId) as { content: string } | undefined;
    console.log(`[competitor-comparison] Saved for project ${projectId}. Verified: ${saved ? "yes, " + saved.content.length + " chars" : "NO"}`);
    if (saved) {
      console.log(`[competitor-comparison] Saved markdown first 1000 chars:\n${saved.content.substring(0, 1000)}`);
    }

    // Return streamed response (even though data is small, match DocumentPanel pattern)
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(markdown));
        controller.close();
      },
    });

    return new NextResponse(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate comparison";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function comparisonToMarkdown(result: {
  competitors: Array<{ url: string; name: string; startingPrice: string; features: string[] }>;
  generatedAt: string;
}): string {
  const lines: string[] = [
    "# Competitor Comparison",
    `Generated: ${result.generatedAt}`,
    "",
    "## Competitors at a Glance",
    "",
  ];

  for (const comp of result.competitors) {
    lines.push(`### ${comp.name}`);
    lines.push(`**URL:** ${comp.url}`);
    lines.push(`**Starting Price:** ${comp.startingPrice}`);
    lines.push("**Key Features:**");
    for (const feature of comp.features) {
      lines.push(`- ${feature}`);
    }
    lines.push("");
  }

  lines.push("## Analysis");
  lines.push(
    "Pricing and features extracted from competitor websites. Regenerate anytime to refresh."
  );

  return lines.join("\n");
}
