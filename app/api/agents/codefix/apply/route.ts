import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { resolveCodeFixContext, findFinding } from "@/lib/domain/codefix/resolveContext";
import { getCodeFixProvider } from "@/lib/domain/codefix/getCodeFixProvider";
import type { CodeFixContext, ProposedFix } from "@/lib/domain/codefix/types";
import type { Finding, SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

/** Takes the exact ProposedFix the user reviewed on /propose — never
 * re-generates it here, so what gets committed is exactly what was shown.
 * No credit charge here: the LLM generation already happened, and was
 * already charged, on /propose. Opening the PR is not itself a generation
 * call. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const issueId: string | undefined = body?.issueId;
  const proposed: ProposedFix | undefined = body?.proposed;
  const model: string | undefined = body?.model;
  const providerId: string | undefined = body?.providerId;

  if (!issueId || !proposed) return NextResponse.json({ error: "issueId and proposed are required" }, { status: 400 });
  if (!model || !providerId) {
    return NextResponse.json({ error: "No model selected." }, { status: 422 });
  }

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    try {
      const { data: setting } = await db
        .from("user_settings")
        .select("value")
        .eq("user_id", user.id)
        .eq("key", "active_project_id")
        .maybeSingle();
      const activeId = setting?.value;
      if (!activeId) return NextResponse.json({ error: "No active project — add a website first." }, { status: 422 });

      const { data: project } = await db
        .from("projects")
        .select("id, name, url")
        .eq("id", activeId)
        .eq("owner_id", user.id)
        .maybeSingle();
      if (!project) return NextResponse.json({ error: "No active project — add a website first." }, { status: 422 });

      // GitHub PAT + repo — same storage convention as propose/route.ts:
      // PAT in provider_connections (provider_id "github", vault-encrypted),
      // repo full name in the generic user_settings key/value table.
      const { data: githubConn } = await db
        .from("provider_connections")
        .select("api_key_secret_id")
        .eq("user_id", user.id)
        .eq("provider_id", "github")
        .maybeSingle();
      const { data: repoSetting } = await db
        .from("user_settings")
        .select("value")
        .eq("user_id", user.id)
        .eq("key", "github_repo")
        .maybeSingle();

      if (!githubConn?.api_key_secret_id || !repoSetting?.value) {
        return NextResponse.json({ error: "GitHub isn't connected — connect it in Settings → API Credentials." }, { status: 422 });
      }

      const { data: githubTokenSecret } = await db.rpc("vault_get_secret", { p_id: githubConn.api_key_secret_id });
      const githubToken = (githubTokenSecret as string) ?? "";
      if (!githubToken) {
        return NextResponse.json({ error: "GitHub isn't connected — connect it in Settings → API Credentials." }, { status: 422 });
      }

      const ctx: CodeFixContext = {
        projectId: project.id,
        projectName: project.name,
        projectUrl: project.url,
        repoFullName: repoSetting.value,
        githubToken,
      };

      // TODO(platform-mode): schema gap - `seo_audits` isn't in the
      // documented Postgres schema for this task cluster (same gap flagged
      // in codefix/propose/route.ts and app/api/project/[id]/route.ts's
      // DELETE handler). applyFix() needs the original Finding, not just
      // the already-approved ProposedFix, so this is blocked the same way
      // propose is. Attempt the lookup anyway in case the table exists but
      // wasn't documented for this task.
      const { data: auditRow, error: auditError } = await db
        .from("seo_audits")
        .select("payload")
        .eq("project_id", ctx.projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (auditError) {
        return NextResponse.json(
          {
            error:
              "Applying code fixes isn't available in platform mode yet — the SEO findings table (seo_audits) hasn't been migrated to Postgres. Self-host mode is unaffected.",
          },
          { status: 501 }
        );
      }
      if (!auditRow) {
        return NextResponse.json(
          { error: "No SEO audit found for this project yet — run one in Analytics → SEO first." },
          { status: 422 }
        );
      }

      const payload = auditRow.payload as SEOAuditPayload;
      const finding: Finding | undefined = payload.findings?.find((f) => f.issueId === issueId);
      if (!finding) {
        return NextResponse.json(
          { error: "That finding wasn't found in the latest audit — it may have already been fixed. Re-run the audit." },
          { status: 422 }
        );
      }

      const driver = getDriver(providerId);
      if (!driver) return NextResponse.json({ error: `${providerId} isn't wired to a real model yet.` }, { status: 501 });

      const { data: llmConn } = await db
        .from("provider_connections")
        .select("api_key_secret_id, base_url")
        .eq("user_id", user.id)
        .eq("provider_id", providerId)
        .maybeSingle();
      if (!llmConn?.api_key_secret_id) {
        return NextResponse.json(
          { error: `${providerId} isn't connected yet. Connect it in Settings → LLM Providers.` },
          { status: 422 }
        );
      }
      const { data: llmSecret } = await db.rpc("vault_get_secret", { p_id: llmConn.api_key_secret_id });
      const llmApiKey = (llmSecret as string) ?? "";
      if (!llmApiKey) {
        return NextResponse.json(
          { error: `${providerId} isn't connected yet. Connect it in Settings → LLM Providers.` },
          { status: 422 }
        );
      }

      const provider = getCodeFixProvider("contents-api", driver, llmApiKey, model, llmConn.base_url ?? undefined);
      const { prUrl, branch } = await provider.applyFix(proposed, ctx, finding);

      const { data: existingFix } = await db
        .from("code_fixes")
        .select("created_at")
        .eq("project_id", ctx.projectId)
        .eq("issue_id", issueId)
        .maybeSingle();

      const now = new Date().toISOString();
      const { error: upsertError } = await db.from("code_fixes").upsert(
        {
          user_id: user.id,
          project_id: ctx.projectId,
          issue_id: issueId,
          status: "pr_open",
          pr_url: prUrl,
          file_path: proposed.filePath,
          created_at: existingFix?.created_at ?? now,
          updated_at: now,
        },
        { onConflict: "project_id,issue_id" }
      );
      if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

      return NextResponse.json({ prUrl, branch });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to open PR." }, { status: 500 });
    }
  }

  try {
    const ctx = resolveCodeFixContext();
    const finding = findFinding(ctx.projectUrl, issueId);

    const driver = getDriver(providerId);
    if (!driver) return NextResponse.json({ error: `${providerId} isn't wired to a real model yet.` }, { status: 501 });

    const db = getDb();
    const connRow = db.prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?").get(providerId) as
      | { api_key: string; base_url: string | null }
      | undefined;
    if (!connRow) return NextResponse.json({ error: `${providerId} isn't connected yet.` }, { status: 422 });

    const provider = getCodeFixProvider("contents-api", driver, connRow.api_key, model, connRow.base_url ?? undefined);
    const { prUrl, branch } = await provider.applyFix(proposed, ctx, finding);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO code_fixes (id, project_id, issue_id, status, pr_url, file_path, created_at, updated_at)
       VALUES (@id, @projectId, @issueId, 'pr_open', @prUrl, @filePath, @now, @now)
       ON CONFLICT(project_id, issue_id) DO UPDATE SET
         status = 'pr_open', pr_url = excluded.pr_url, file_path = excluded.file_path, updated_at = excluded.updated_at`
    ).run({
      id: `fix_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      projectId: ctx.projectId,
      issueId,
      prUrl,
      filePath: proposed.filePath,
      now,
    });

    return NextResponse.json({ prUrl, branch });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to open PR." }, { status: 500 });
  }
}
