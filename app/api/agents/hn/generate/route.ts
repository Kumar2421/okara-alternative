import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { HNAgent } from "@/lib/domain/hn/HNAgent";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { description, highlights, providerId, model } = body as {
    description: string;
    highlights: string;
    providerId?: string;
    model?: string;
  };

  if (!description || !highlights) {
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
    return NextResponse.json(
      { error: `${providerId} isn't wired to a real model yet.` },
      { status: 501 }
    );
  }

  const db = getDb();
  const row = db
    .prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?")
    .get(providerId) as { api_key: string; base_url: string | null } | undefined;

  if (!row) {
    return NextResponse.json(
      { error: `${providerId} isn't connected yet.` },
      { status: 422 }
    );
  }

  try {
    const generator = new HNAgent(driver, row.api_key, row.base_url ?? undefined);
    const result = await generator.generate({ description, highlights, model });

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
