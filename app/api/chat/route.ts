import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import type { ChatMessage } from "@/lib/llm";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body || typeof body.message !== "string" || !body.message.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const { message, model, providerId, history } = body as {
    message: string;
    model?: string;
    providerId?: string;
    history?: ChatMessage[];
  };

  if (!model || !providerId) {
    return NextResponse.json(
      { error: "No model selected. Connect a provider in Settings → LLM Providers." },
      { status: 422 }
    );
  }

  const driver = getDriver(providerId);
  if (!driver) {
    return NextResponse.json(
      { error: `${providerId} isn't wired to a real model yet — only Anthropic, OpenAI, and Google are live so far.` },
      { status: 501 }
    );
  }

  const db = getDb();
  const row = db
    .prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?")
    .get(providerId) as { api_key: string; base_url: string | null } | undefined;

  if (!row) {
    return NextResponse.json(
      { error: `${providerId} isn't connected yet. Connect it in Settings → LLM Providers.` },
      { status: 422 }
    );
  }

  try {
    const result = await driver({
      apiKey: row.api_key,
      model,
      messages: [...(history ?? []), { role: "user", content: message }],
      baseUrl: row.base_url ?? undefined,
    });
    return NextResponse.json({ reply: result.text });
  } catch (err) {
    return NextResponse.json({ error: friendlyProviderError(providerId, err) }, { status: 502 });
  }
}

/** SDK errors are verbose (raw JSON bodies, stack-ish text) — trim to something a chat bubble can show. */
function friendlyProviderError(providerId: string, err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  if (/authentication|invalid.*api.?key|401/i.test(raw)) {
    return `${providerId}: API key was rejected. Check it in Settings → LLM Providers.`;
  }
  if (/rate.?limit|429/i.test(raw)) {
    return `${providerId}: rate limited — wait a moment and try again.`;
  }
  if (/model.*(not found|does not exist)|404/i.test(raw)) {
    return `${providerId}: that model isn't available on this account.`;
  }

  return `${providerId} request failed. Try again in a moment.`;
}
