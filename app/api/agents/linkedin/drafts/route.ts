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
import { parseLinkedInBatch } from "@/lib/domain/social/draftParse.ts";
import { isLinkedInDraftStatus, type LinkedInDraftPatch, type LinkedInDraftView } from "@/lib/domain/linkedin/linkedInDraftStore";
import * as sqliteStore from "@/lib/domain/linkedin/linkedInDraftStore";
import * as supabaseStore from "@/lib/domain/linkedin/linkedInDraftStoreSupabase";
import { generateDraftBatch, type DraftGenerationPorts } from "@/lib/domain/social/draftGeneration.ts";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export const maxDuration = 60;

const NO_PROJECT = { error: "No active project." };

function viewOf(req: NextRequest): LinkedInDraftView {
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
      ? await supabaseStore.listLinkedInDrafts(scope.db, scope.userId, scope.projectId, view)
      : sqliteStore.listLinkedInDrafts(getDb(), scope.projectId, view);
    return NextResponse.json({ drafts });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { variants?: number } | null;
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
    } else {
      const row = getDb().prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?").get(providerId) as
        | { api_key: string; base_url: string | null } | undefined;
      if (row) {
        apiKey = row.api_key;
        baseUrl = row.base_url ?? undefined;
      }
      project = getActiveProjectContext();
    }
  } catch (err) {
    return fail(err);
  }

  if (!apiKey) {
    return NextResponse.json({ error: "Connect a free Groq key in Settings, then try again." }, { status: 422 });
  }

  const system = `You are a B2B content marketer writing LinkedIn posts for ${project.name}.
Write insightful, personal posts about this product — not generic advice.
Rules:
- Hook in the first line (LinkedIn truncates after ~2 lines).
- Short paragraphs (1-3 sentences), generous line breaks.
- 100-3000 characters total (hook line + body).
- No hashtag spam (0-3 relevant tags at the end, if any).
- No invented statistics, customer names, or quotes.
- End with a genuine question or takeaway, not a hard sell.

Reply with JSON only, no prose: {"drafts":[{"hookLine":"...","body":"...","whyThisWorks":"...","angle":"..."}]}`;

  const prompt = `Write ${variants} LinkedIn post${variants === 1 ? "" : "s"} about: ${project.name}
${project.description ? `\nDescription: ${project.description}` : ""}
${project.category ? `\nCategory: ${project.category}` : ""}`;

  const ports: DraftGenerationPorts = {
    creditState: async () => scope.mode === "platform" ? getCreditState(scope.userId, "social_draft") : { billingEnabled: false, balance: 0, cost: 0 },
    isByok: !usesPlatformKey,
    limit: scope.mode === "platform" && usesPlatformKey ? dailyDraftBatchLimit(await getUserPlan(scope.userId)) : -1,
    reserveSlot: async (limit) => {
      if (scope.mode === "platform") {
        return supabaseStore.reserveLinkedInBatch(scope.db, scope.userId, scope.projectId, limit, startOfUtcDay());
      }
      return { ok: true, batchId: "" };
    },
    releaseSlot: async (batchId) => {
      if (scope.mode === "platform" && batchId) {
        await supabaseStore.deleteLinkedInBatch(scope.db, scope.userId, scope.projectId, batchId).catch(() => {});
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
    parse: (text) => parseLinkedInBatch(text, variants),
    filterUsable: (drafts) => drafts,
    insertDrafts: async (batchId, drafts) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const withDefaults = (drafts as any[]).map((d) => ({ ...d, angle: "General", whyThisWorks: "" }));
      if (scope.mode === "platform") {
        return batchId
          ? await supabaseStore.fulfilLinkedInBatch(scope.db, scope.userId, scope.projectId, batchId, withDefaults)
          : await supabaseStore.insertLinkedInDrafts(scope.db, scope.userId, scope.projectId, withDefaults);
      }
      return sqliteStore.insertLinkedInDrafts(getDb(), scope.projectId, withDefaults);
    },
    deleteBatch: async (batchId) => {
      if (scope.mode === "platform") {
        await supabaseStore.deleteLinkedInBatch(scope.db, scope.userId, scope.projectId, batchId).catch(() => {});
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
  const body = (await req.json().catch(() => null)) as { id?: unknown; hookLine?: unknown; body?: unknown; status?: unknown } | null;
  if (!body || typeof body.id !== "string") return NextResponse.json({ error: "id is required." }, { status: 400 });

  const patch: LinkedInDraftPatch = {};
  if (body.hookLine !== undefined) {
    if (typeof body.hookLine !== "string" || !body.hookLine.trim()) return NextResponse.json({ error: "Hook line can't be empty." }, { status: 400 });
    patch.hookLine = body.hookLine.trim();
  }
  if (body.body !== undefined) {
    if (typeof body.body !== "string" || !body.body.trim()) return NextResponse.json({ error: "Body can't be empty." }, { status: 400 });
    patch.body = body.body.trim();
  }
  if (body.status !== undefined) {
    if (!isLinkedInDraftStatus(body.status)) return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    patch.status = body.status;
  }
  if (patch.hookLine === undefined && patch.body === undefined && patch.status === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const scope = await resolveScope();
  if (scope instanceof NextResponse) return scope;
  try {
    const draft = scope.mode === "platform"
      ? await supabaseStore.updateLinkedInDraft(scope.db, scope.userId, scope.projectId, body.id, patch)
      : sqliteStore.updateLinkedInDraft(getDb(), scope.projectId, body.id, patch);
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
      ? await supabaseStore.deleteLinkedInDraft(scope.db, scope.userId, scope.projectId, id)
      : sqliteStore.deleteLinkedInDraft(getDb(), scope.projectId, id);
    return removed ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Draft not found." }, { status: 404 });
  } catch (err) {
    return fail(err);
  }
}
