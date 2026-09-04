import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { RedditAgent } from "@/lib/domain/reddit/RedditAgent";
import { getActiveProjectContext } from "@/lib/domain/shared/getActiveProject";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { subreddits, keywords, brandVoice, providerId, model } = body as {
    subreddits?: string;
    keywords: string;
    brandVoice: string;
    providerId?: string;
    model?: string;
  };

  if (!keywords || !brandVoice) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
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
  const row = db
    .prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?")
    .get(providerId) as { api_key: string; base_url: string | null } | undefined;

  if (!row) {
    return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });
  }

  const subList = (subreddits ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const agent = new RedditAgent(driver, row.api_key, row.base_url ?? undefined);
    const { opportunities, usedMockThreads } = await agent.findOpportunities({
      subreddits: subList.length ? subList : ["reactjs", "SaaS"],
      keywords,
      brandVoice,
      model,
      project: getActiveProjectContext(),
    });

    return NextResponse.json({ opportunities, usedMockThreads });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}
