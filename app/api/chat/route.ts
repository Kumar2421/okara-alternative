import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import type { ChatMessage } from "@/lib/llm";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { getActiveProjectContext } from "@/lib/domain/shared/getActiveProject";
import { getActiveProjectContextSupabase } from "@/lib/domain/shared/getActiveProjectSupabase";
import { buildProjectContextBlock } from "@/lib/domain/shared/projectContextPrompt";
import { buildTrafficContextBlock } from "@/lib/domain/shared/trafficContextPrompt";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { chargeCredits, InsufficientCreditsError } from "@/lib/credits";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

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

/** Platform-mode equivalent of buildChatSystemPrompt() — Supabase-scoped to
 * one user instead of the shared local SQLite file.
 *
 * TODO(platform-mode): schema gap - `traffic_checks` isn't in the documented
 * Postgres schema for this task cluster (same category of gap as
 * `seo_audits`, already flagged in app/api/project/[id]/route.ts's DELETE
 * handler and in app/api/agents/codefix/propose+apply/route.ts here). Real
 * cached Search Console/Analytics data can't be read in platform mode yet,
 * so this always falls back to the honest "not cached" message instead of
 * querying a table that isn't confirmed to exist. */
async function buildChatSystemPromptSupabase(db: SupabaseClient, userId: string): Promise<string> {
  const { data: setting } = await db
    .from("user_settings")
    .select("value")
    .eq("user_id", userId)
    .eq("key", "active_project_id")
    .maybeSingle();
  const activeId = setting?.value;
  if (!activeId) return STYLE_INSTRUCTION;

  const project = await getActiveProjectContextSupabase(db, userId);
  const block = buildProjectContextBlock(project);

  const trafficBlock =
    "\nNo real Traffic data cached yet — the user hasn't opened Analytics → Traffic for this project. Don't invent traffic or ranking numbers; say so if asked.";

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

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    const { data: conn } = await db
      .from("provider_connections")
      .select("api_key_secret_id, base_url")
      .eq("user_id", user.id)
      .eq("provider_id", providerId)
      .maybeSingle();
    if (!conn?.api_key_secret_id) {
      return NextResponse.json(
        { error: `${providerId} isn't connected yet. Connect it in Settings → LLM Providers.` },
        { status: 422 }
      );
    }

    const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
    const apiKey = (secret as string) ?? "";
    if (!apiKey) {
      return NextResponse.json(
        { error: `${providerId} isn't connected yet. Connect it in Settings → LLM Providers.` },
        { status: 422 }
      );
    }

    // Charge once per message sent, before the model call — there's no
    // streaming here (a plain JSON reply), so unlike articles/generate
    // there's no "charge before starting the stream" split; this is just
    // "charge before attempting the generation".
    try {
      await chargeCredits(user.id, "chat_message", { model });
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        return NextResponse.json({ error: "Out of credits. Upgrade or connect your own key." }, { status: 402 });
      }
      throw err;
    }

    try {
      const system = await buildChatSystemPromptSupabase(db, user.id);
      const result = await driver({
        apiKey,
        model,
        system,
        messages: [...(history ?? []), { role: "user", content: message }],
        baseUrl: conn.base_url ?? undefined,
      });
      return NextResponse.json({ reply: result.text });
    } catch (err) {
      // Note: credits already charged for this message — no refund path yet
      // on generation failure. Same tradeoff articles/generate makes.
      return NextResponse.json({ error: friendlyProviderError(providerId, err) }, { status: 502 });
    }
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
