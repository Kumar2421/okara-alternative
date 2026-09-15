import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import type { ChatMessage } from "@/lib/llm";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { getActiveProjectContext } from "@/lib/domain/shared/getActiveProject";
import { buildProjectContextBlock } from "@/lib/domain/shared/projectContextPrompt";
import { buildTrafficContextBlock } from "@/lib/domain/shared/trafficContextPrompt";

/** ChatPanel renders replies as plain text — no markdown parser (see
 * components/dashboard/ChatPanel.tsx, `<p>{msg.text}</p>`) — so `**bold**`,
 * numbered-list markdown, headers, and emoji-heavy formatting all show up
 * as literal clutter instead of rendering as anything. This is the fix:
 * tell the model to write what the UI actually displays, not a markdown
 * renderer it doesn't have. Always present, even with no active project. */
const STYLE_INSTRUCTION = `Write in plain conversational text only — this is displayed as-is, with no markdown rendering. Never use markdown syntax: no **bold**, no # headers, no markdown bullet/numbered lists, no code fences. Use plain sentences and, if you need a list, write it as short lines separated by a real line break, not markdown dashes or asterisks. Don't use emoji unless the user uses them first. Be concise — skip preamble and filler.`;

/** Chat had zero project awareness before this — no system prompt at all,
 * so it didn't know the product's name, let alone its real Product
 * Information/Marketing Strategy docs or how it's actually performing in
 * search. Reuses the same context block the content agents (Articles,
 * LinkedIn, Reddit, X) already ground their prompts in, plus real cached
 * Traffic data on top — nothing fabricated when either is missing. */
function buildChatSystemPrompt(): string {
  const activeId = getActiveProjectId();
  if (!activeId) return STYLE_INSTRUCTION;

  const project = getActiveProjectContext();
  const block = buildProjectContextBlock(project);

  const traffic = buildTrafficContextBlock(activeId);
  const trafficBlock = traffic
    ? `\nReal traffic/ranking data:\n${traffic}`
    : "\nNo real Traffic data cached yet — the user hasn't opened Analytics → Traffic for this project. Don't invent traffic or ranking numbers; say so if asked.";

  return `${STYLE_INSTRUCTION}\n\n${block}\n${trafficBlock}`;
}

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
    const system = buildChatSystemPrompt();
    const result = await driver({
      apiKey: row.api_key,
      model,
      system,
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
