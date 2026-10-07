import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { PLATFORM_DEFAULT_MODELS, PLATFORM_PROVIDER_KEYS } from "@/lib/llm/platformKeys";
import { FEATURES } from "@/lib/features";
import { getUserPlan } from "@/lib/entitlements";
import { chargeCredits, getCreditState, InsufficientCreditsError } from "@/lib/credits";
import { canAffordCredits } from "@/lib/domain/x/draftGuards";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { getActiveProjectContext } from "@/lib/domain/shared/getActiveProject";
import { getActiveProjectContextSupabase } from "@/lib/domain/shared/getActiveProjectSupabase";
import type { ProjectContext } from "@/lib/domain/shared/ProjectContext";
import { buildDraftPrompt, clampVariants, isWithinLimit, parseDraftBatch } from "@/lib/domain/x/draftPost";
import { dailyDraftBatchLimit, isXDraftStatus, type XDraftPatch, type XDraftView } from "@/lib/domain/x/xDraftTypes";
import * as sqliteStore from "@/lib/domain/x/xDraftStore";
import * as supabaseStore from "@/lib/domain/x/xDraftStoreSupabase";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export const maxDuration = 60;

const NO_PROJECT = { error: "No active project." };

function viewOf(req: NextRequest): XDraftView {
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

/** Resolve who is asking and which project; a NextResponse means "stop here". */
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
      ? await supabaseStore.listXDrafts(scope.db, scope.userId, scope.projectId, view)
      : sqliteStore.listXDrafts(getDb(), scope.projectId, view);
    return NextResponse.json({ drafts });
  } catch (err) {
    return fail(err);
  }
}

/** Generate a batch of 1 to 3 drafts from the project's product info. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { variants?: number } | null;
  const variants = clampVariants(body?.variants);
  const scope = await resolveScope();
  if (scope instanceof NextResponse) return scope;

  const providerId = "groq";
  const driver = getDriver(providerId);
  if (!driver) return NextResponse.json({ error: "Groq isn't wired to a real model yet." }, { status: 501 });

  let apiKey = "";
  let baseUrl: string | undefined;
  let usesPlatformKey = false;
  let project: ProjectContext;
  let reservedBatchId: string | null = null;
  const release = async () => {
    if (scope.mode === "platform" && reservedBatchId) {
      await supabaseStore.deleteXBatch(scope.db, scope.userId, scope.projectId, reservedBatchId).catch(() => {});
      reservedBatchId = null;
    }
  };

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

      if (usesPlatformKey) {
        // Never spend platform tokens for a user who can't pay, whatever their plan.
        if (!canAffordCredits(await getCreditState(scope.userId, "social_draft"))) {
          return NextResponse.json({ error: "Out of credits. Upgrade or connect your own key." }, { status: 402 });
        }
        const limit = dailyDraftBatchLimit(await getUserPlan(scope.userId));
        if (limit !== -1) {
          // Claim the slot before the model call so parallel requests can't exceed the cap.
          const slot = await supabaseStore.reserveXBatch(scope.db, scope.userId, scope.projectId, limit, startOfUtcDay());
          if (!slot.ok) {
            return NextResponse.json({ error: `Daily limit reached (${limit} batches). Try again tomorrow, or connect your own Groq key.`, limit }, { status: 429 });
          }
          reservedBatchId = slot.batchId;
        }
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
    await release();
    return fail(err);
  }

  if (!apiKey) {
    await release();
    return NextResponse.json({ error: "Connect a free Groq key in Settings, then try again." }, { status: 422 });
  }

  const { system, prompt } = buildDraftPrompt({
    name: project.name,
    description: project.description,
    category: project.category,
    productInfo: project.productInfo,
    marketingStrategy: project.marketingStrategy,
    variants,
  });

  let text: string;
  try {
    const result = await driver({
      apiKey, baseUrl, system, model: PLATFORM_DEFAULT_MODELS[providerId], stream: false,
      messages: [{ role: "user", content: prompt }],
    });
    text = result.text ?? "";
  } catch (err) {
    await release();
    return fail(err, 502);
  }

  const { drafts, errors } = parseDraftBatch(text, variants);
  const usable = drafts.filter((d) => isWithinLimit(d.text));
  if (usable.length === 0) {
    await release();
    return NextResponse.json({ error: "The model returned drafts we couldn't use. Nothing was charged; try again.", details: errors.slice(0, 3) }, { status: 502 });
  }

  try {
    if (scope.mode === "platform") {
      // Save first, then charge; if the charge fails the drafts are rolled back, so nobody pays for nothing or gets free output.
      const batchId = reservedBatchId;
      const created = batchId
        ? await supabaseStore.fulfilXBatch(scope.db, scope.userId, scope.projectId, batchId, usable)
        : await supabaseStore.insertXDrafts(scope.db, scope.userId, scope.projectId, usable);
      reservedBatchId = null;
      if (usesPlatformKey) {
        try {
          await chargeCredits(scope.userId, "social_draft", { projectId: scope.projectId, model: PLATFORM_DEFAULT_MODELS[providerId] });
        } catch (err) {
          const batch = created[0]?.batchId;
          if (batch) await supabaseStore.deleteXBatch(scope.db, scope.userId, scope.projectId, batch).catch(() => {});
          if (err instanceof InsufficientCreditsError) {
            return NextResponse.json({ error: "Out of credits. Upgrade or connect your own key." }, { status: 402 });
          }
          throw err;
        }
      }
      return NextResponse.json({ drafts: created }, { status: 201 });
    }
    return NextResponse.json({ drafts: sqliteStore.insertXDrafts(getDb(), scope.projectId, usable) }, { status: 201 });
  } catch (err) {
    await release();
    return fail(err);
  }
}

/** Edit the text and/or move a draft between Current and Archived. */
export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { id?: unknown; text?: unknown; status?: unknown } | null;
  if (!body || typeof body.id !== "string") return NextResponse.json({ error: "id is required." }, { status: 400 });

  const patch: XDraftPatch = {};
  if (body.text !== undefined) {
    if (typeof body.text !== "string" || !body.text.trim()) return NextResponse.json({ error: "Text can't be empty." }, { status: 400 });
    if (!isWithinLimit(body.text)) return NextResponse.json({ error: "Text is over the 280 character limit." }, { status: 400 });
    patch.text = body.text.trim();
  }
  if (body.status !== undefined) {
    if (!isXDraftStatus(body.status)) return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    patch.status = body.status;
  }
  if (patch.text === undefined && patch.status === undefined) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  const scope = await resolveScope();
  if (scope instanceof NextResponse) return scope;
  try {
    const draft = scope.mode === "platform"
      ? await supabaseStore.updateXDraft(scope.db, scope.userId, scope.projectId, body.id, patch)
      : sqliteStore.updateXDraft(getDb(), scope.projectId, body.id, patch);
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
      ? await supabaseStore.deleteXDraft(scope.db, scope.userId, scope.projectId, id)
      : sqliteStore.deleteXDraft(getDb(), scope.projectId, id);
    return removed ? NextResponse.json({ success: true }) : NextResponse.json({ error: "Draft not found." }, { status: 404 });
  } catch (err) {
    return fail(err);
  }
}
