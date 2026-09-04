import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { XAgent } from "@/lib/domain/x/XAgent";
import { getActiveProjectContext } from "@/lib/domain/shared/getActiveProject";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { topic, brandVoice, providerId, model } = body as {
    topic: string;
    brandVoice: string;
    providerId?: string;
    model?: string;
  };

  if (!topic || !brandVoice) {
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

  const xCredsRow = db
    .prepare("SELECT value FROM settings WHERE key = 'x_api_key'")
    .get() as { value: string } | undefined;

  try {
    const agent = new XAgent(driver, row.api_key, xCredsRow?.value, row.base_url ?? undefined);
    const result = await agent.generateThread({ topic, brandVoice, model, project: getActiveProjectContext() });

    if (result.stream) {
      return new NextResponse(result.stream, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return NextResponse.json({ text: result.text });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}
