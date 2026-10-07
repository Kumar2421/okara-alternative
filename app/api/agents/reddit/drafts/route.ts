import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { PLATFORM_DEFAULT_MODELS, PLATFORM_PROVIDER_KEYS } from "@/lib/llm/platformKeys";
import { FEATURES } from "@/lib/features";
import { getUserPlan } from "@/lib/entitlements";
import { chargeCredits, getCreditState } from "@/lib/credits";
import { dailyDraftBatchLimit } from "@/lib/domain/x/xDraftTypes";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { getActiveProjectContext } from "@/lib/domain/shared/getActiveProject";
import { getActiveProjectContextSupabase } from "@/lib/domain/shared/getActiveProjectSupabase";
import type { ProjectContext } from "@/lib/domain/shared/ProjectContext";
import { parseRedditBatch } from "@/lib/domain/social/draftParse.ts";
import { isRedditDraftStatus, type RedditDraftPatch, type RedditDraftView } from "@/lib/domain/reddit/redditDraftStore";
import { getRedditSettings } from "@/lib/domain/reddit/redditSettingsStore";
import { getRedditSettings as getRedditSettingsSupabase } from "@/lib/domain/reddit/redditSettingsStoreSupabase";
import * as sqliteStore from "@/lib/domain/reddit/redditDraftStore";
import * as supabaseStore from "@/lib/domain/reddit/redditDraftStoreSupabase";
import { generateDraftBatch, type DraftGenerationPorts } from "@/lib/domain/social/draftGeneration.ts";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export const maxDuration = 60;

const NO_PROJECT = { error: "No active project." };

function viewOf(req: NextRequest): RedditDraftView {
  return req.nextUrl.searchParams.get("view") === "archived" ? "archived" : "current";
}

function startOfUtcDay(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

type Scope =
  | { mode: "platform"; db: ReturnType<typeof createServiceClient>; userId: string; projectId: string }
  | { mode: "selfhost"; projectId: string };

async function resolveScope(): Promise<Scope | NextResponse> {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = createServiceClient();
    const { data: setting } = await db.from("user_settings").select("value").eq("user_id", user.id).eq("key", "active_project_id").maybeSingle();
    const projectId = setting?.value as string | undefined;
    if (!projectId) return NextResponse.json(NO_PROJECT, { status: 422 });
    return { mode: "platform", db, userId: user.id, projectId };
  }
  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json(NO_PROJECT, { status: 422 });
  return { mode: "selfhost", projectId };
}

function fail(err: unknown, status = 500) {
  return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
}

export async function GET(req: NextRequest) {
  const scope = await resolveScope();
  if (scope instanceof NextResponse) return scope;
  try {
    const view = viewOf(req);
    const drafts = scope.mode === "platform"
      ? await supabaseStore.listRedditDrafts(scope.db, scope.userId, scope.projectId, view)
      : sqliteStore.listRedditDrafts(getDb(), scope.projectId, view);
    return NextResponse.json({ drafts });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { variants?: number; subreddit?: string } | null;
  const variants = Math.min(3, Math.max(1, Math.floor(body?.variants ?? 1)));
  const scope = await resolveScope();
  if (scope instanceof NextResponse) return scope;

  const providerId = "groq";
  const driver = getDriver(providerId);
  if (!driver) return NextResponse.json({ error: "Groq isn't wired to a real model yet." }, { status: 501 });

  let apiKey = "";
  let baseUrl: string | undefined;
  let usesPlatformKey = false;
  let project: ProjectContext;
  let defaultSubreddit = "";

  try {
    if (scope.mode === "platform") {
      const { data: conn } = await scope.db.from("provider_connections").select("api_key_secret_id, base_url")
        .eq("user_id", scope.userId).eq("provider_id", providerId).maybeSingle();
      if (conn?.api_key_secret_id) {
        const { data: secret } = await scope.db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
        apiKey = (secret as string) ?? "";
        baseUrl = conn.base_url ?? undefined;
      } else if (PLATFORM_PROVIDER_KEYS[providerId]) {
        apiKey = PLATFORM_PROVIDER_KEYS[providerId]!;
        usesPlatformKey = true;
      }
      project = await getActiveProjectContextSupabase(scope.db, scope.userId);

      // Try to get default subreddit from saved Reddit settings
      try {
        const settings = await getRedditSettingsSupabase(scope.db, scope.userId, scope.projectId);
        if (settings.subreddits.length > 0) {
          defaultSubreddit = settings.subreddits[0].replace(/^r\//, "");
        }
      } catch {
        // Ignore errors; defaultSubreddit stays empty
      }
    } else {
      const row = getDb().prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?").get(providerId) as
        | { api_key: string; base_url: string | null } | undefined;
      if (row) {
        apiKey = row.api_key;
        baseUrl = row.base_url ?? undefined;
      }
      project = getActiveProjectContext();

      // Try to get default subreddit from saved Reddit settings
      try {
        const settings = getRedditSettings(getDb(), scope.projectId);
        if (settings.subreddits.length > 0) {
          defaultSubreddit = settings.subreddits[0].replace(/^r\//, "");
        }
      } catch {
        // Ignore errors; defaultSubreddit stays empty
      }
    }
  } catch (err) {
    return fail(err);
  }

  if (!apiKey) {
    return NextResponse.json({ error: "Connect a free Groq key in Settings, then try again." }, { status: 422 });
  }

  const requestedSubreddit = body?.subreddit ? (body.subreddit as string).replace(/^r\//, "") : defaultSubreddit;
  if (!requestedSubreddit) {
    return NextResponse.json({ error: "Specify a subreddit or configure one in Settings." }, { status: 422 });
  }

  if (!/^[A-Za-z0-9_]{2,21}$/.test(requestedSubreddit)) {
    return NextResponse.json({ error: `Invalid subreddit: '${requestedSubreddit}'. Use 2-21 alphanumeric characters and underscores.` }, { status: 400 });
  }

  const system = `You are a Reddit contributor writing posts for r/${requestedSubreddit} about ${project.name}.
Be conversational and community-friendly; match the subreddit's tone.
Rules:
- Title: 1-300 characters, clear and engaging (no clickbait).
- Body: 1-40000 characters, natural discussion (no spam or hard sales).
- No invented statistics, customer names, or quotes.
- Be helpful and ask for feedback, not selling.

Reply with JSON only, no prose: {"drafts":[{"subreddit":"${requestedSubreddit}","title":"...","body":"...","whyThisWorks":"...","angle":"..."}]}`;

  const prompt = `Write ${variants} Reddit post${variants === 1 ? "" : "s"} for r/${requestedSubreddit} about: ${project.name}
${project.description ? `\nDescription: ${project.description}` : ""}
${project.category ? `\nCategory: ${project.category}` : ""}`;

  const ports: DraftGenerationPorts = {
    creditState: async () => scope.mode === "platform" ? getCreditState(scope.userId, "social_draft") : { billingEnabled: false, balance: 0, cost: 0 },
    isByok: !usesPlatformKey,
    limit: scope.mode === "platform" && usesPlatformKey ? dailyDraftBatchLimit(await getUserPlan(scope.userId)) : -1,
    reserveSlot: async (limit) => {
      if (scope.mode === "platform") {
        return supabaseStore.reserveRedditBatch(scope.db, scope.userId, scope.projectId, limit, startOfUtcDay());
      }
      return { ok: true, batchId: "" };
    },
    releaseSlot: async (batchId) => {
      if (scope.mode === "platform" && batchId) {
        await supabaseStore.deleteRedditBatch(scope.db, scope.userId, scope.projectId, batchId).catch(() => {});
      }
    },
    callModel: async () => {
      const result = await driver({
        apiKey,
        baseUrl,
        system,
        model: PLATFORM_DEFAULT_MODELS[providerId],
        stream: false,
        messages: [{ role: "user", content: prompt }],
      });
      return result.text ?? "";
    },
    parse: (text) => parseRedditBatch(text, variants),
    filterUsable: (drafts) => drafts,
    insertDrafts: async (batchId, drafts) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const withDefaults = (drafts as any[]).map((d) => ({ ...d, angle: "General", whyThisWorks: "" }));
      if (scope.mode === "platform") {
        return batchId
          ? await supabaseStore.fulfilRedditBatch(scope.db, scope.userId, scope.projectId, batchId, withDefaults)
          : await supabaseStore.insertRedditDrafts(scope.db, scope.userId, scope.projectId, withDefaults);
      }
      return sqliteStore.insertRedditDrafts(getDb(), scope.projectId, withDefaults);
    },
    deleteBatch: async (batchId) => {
      if (scope.mode === "platform") {
        await supabaseStore.deleteRedditBatch(scope.db, scope.userId, scope.projectId, batchId).catch(() => {});
      }
    },
    charge: async () => {
      if (usesPlatformKey && scope.mode === "platform") {
        await chargeCredits(scope.userId, "social_draft", { projectId: scope.projectId, model: PLATFORM_DEFAULT_MODELS[providerId] });
      }
    },
  };

  const result = await generateDraftBatch(ports, { variants });
  return NextResponse.json(result.body, { status: result.status });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { id?: unknown; subreddit?: unknown; title?: unknown; body?: unknown; status?: unknown } | null;
  if (!body || typeof body.id !== "string") return NextResponse.json({ error: "id is required." }, { status: 400 });

  const patch: RedditDraftPatch = {};
  if (body.subreddit !== undefined) {
    if (typeof body.subreddit !== "string" || !body.subreddit.trim()) return NextResponse.json({ error: "Subreddit can't be empty." }, { status: 400 });
    if (!/^[A-Za-z0-9_]{2,21}$/.test(body.subreddit.trim())) {
      return NextResponse.json({ error: "Invalid subreddit name." }, { status: 400 });
    }
    patch.subreddit = body.subreddit.trim();
  }
  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) return NextResponse.json({ error: "Title can't be empty." }, { status: 400 });
    if (body.title.trim().length > 300) return NextResponse.json({ error: "Title is over 300 characters." }, { status: 400 });
    patch.title = body.title.trim();
  }
  if (body.body !== undefined) {
    if (typeof body.body !== "string" || !body.body.trim()) return NextResponse.json({ error: "Body can't be empty." }, { status: 400 });
    if (body.body.trim().length > 40000) return NextResponse.json({ error: "Body is over 40000 characters." }, { status: 400 });
    patch.body = body.body.trim();
  }
  if (body.status !== undefined) {
    if (!isRedditDraftStatus(body.status)) return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    patch.status = body.status;
  }
  if (patch.subreddit === undefined && patch.title === undefined && patch.body === undefined && patch.status === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const scope = await resolveScope();
  if (scope instanceof NextResponse) return scope;
  try {
    const draft = scope.mode === "platform"
      ? await supabaseStore.updateRedditDraft(scope.db, scope.userId, scope.projectId, body.id, patch)
      : sqliteStore.updateRedditDraft(getDb(), scope.projectId, body.id, patch);
    return draft ? NextResponse.json({ draft }) : NextResponse.json({ error: "Draft not found." }, { status: 404 });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const scope = await resolveScope();
  if (scope instanceof NextResponse) return scope;
  try {
    const removed = scope.mode === "platform"
      ? await supabaseStore.deleteRedditDraft(scope.db, scope.userId, scope.projectId, id)
      : sqliteStore.deleteRedditDraft(getDb(), scope.projectId, id);
    return removed ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Draft not found." }, { status: 404 });
  } catch (err) {
    return fail(err);
  }
}
