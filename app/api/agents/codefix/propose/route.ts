import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDriver } from "@/lib/llm";
import { resolveCodeFixContext, findFinding } from "@/lib/domain/codefix/resolveContext";
import { getCodeFixProvider } from "@/lib/domain/codefix/getCodeFixProvider";
import type { CodeFixContext } from "@/lib/domain/codefix/types";
import type { Finding, SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { chargeCredits, InsufficientCreditsError } from "@/lib/credits";

// Vercel: LLM/crawl calls can run past the 10s default — allow up to the
// platform max for this route (Hobby plan caps at 60s; Pro allows more).
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const issueId: string | undefined = body?.issueId;
  const model: string | undefined = body?.model;
  const providerId: string | undefined = body?.providerId;

  if (!issueId) return NextResponse.json({ error: "issueId is required" }, { status: 400 });
  if (!model || !providerId) {
    return NextResponse.json({ error: "No model selected. Connect a provider in Settings → LLM Providers." }, { status: 422 });
  }

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    try {
      // --- Resolve active project (Supabase equivalent of resolveCodeFixContext()'s
      // project lookup) ---
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

      // --- GitHub PAT + repo. Self-host reads these from `settings`
      // (github_pat/github_repo) — see resolveCodeFixContext(). GitHub isn't
      // in integration_connections' `provider` CHECK constraint (only
      // gmail/ga4/gsc/gcp), so per the platform-mode convention this is
      // treated as a BYOK "provider" like an LLM key: the PAT lives in
      // provider_connections under provider_id "github", vault-encrypted.
      // The repo full name ("owner/repo") isn't a secret and has no natural
      // column on provider_connections, so it's stored in the generic
      // user_settings key/value table (same table already used for
      // primaryModel / active_project_id). ---
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

      // --- Existing fix status (same conflict rules as self-host) ---
      const { data: existing } = await db
        .from("code_fixes")
        .select("status, pr_url")
        .eq("project_id", ctx.projectId)
        .eq("issue_id", issueId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (existing && (existing.status === "pr_open" || existing.status === "merged")) {
        return NextResponse.json(
          { error: `Already has a real PR for this: ${existing.pr_url}`, prUrl: existing.pr_url },
          { status: 409 }
        );
      }
      if (existing && existing.status === "rejected") {
        return NextResponse.json(
          { error: "This fix was previously rejected — won't auto-retry. Delete that record to try again." },
          { status: 409 }
        );
      }

      // TODO(platform-mode): schema gap - `seo_audits` isn't in the
      // documented Postgres schema for this task cluster (same category of
      // gap already flagged in app/api/project/[id]/route.ts's DELETE
      // handler). Findings only exist as a per-project SEO audit payload in
      // SQLite today. Attempt the lookup anyway (in case the table exists
      // but wasn't listed for this task) and surface a clear, actionable
      // error instead of a raw Postgres error or a silent 500 if it doesn't.
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
              "Code-fix proposals aren't available in platform mode yet — the SEO findings table (seo_audits) hasn't been migrated to Postgres. Self-host mode is unaffected.",
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
      if (!finding.autoFixable) {
        return NextResponse.json({ error: "This finding isn't eligible for an automatic code fix." }, { status: 422 });
      }

      const driver = getDriver(providerId);
      if (!driver) {
        return NextResponse.json({ error: `${providerId} isn't wired to a real model yet.` }, { status: 501 });
      }

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

      // code_fix agent action — metered whenever a fix is actually proposed
      // (an LLM call happens next), regardless of which LLM key served it.
      try {
        await chargeCredits(user.id, "code_fix", { projectId: ctx.projectId, model });
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          return NextResponse.json({ error: "Out of credits. Upgrade or connect your own key." }, { status: 402 });
        }
        throw err;
      }

      const provider = getCodeFixProvider("contents-api", driver, llmApiKey, model, llmConn.base_url ?? undefined);
      const proposed = await provider.proposeFix(finding, ctx);

      return NextResponse.json({ finding, proposed });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to draft a fix." }, { status: 500 });
    }
  }

  try {
    const ctx = resolveCodeFixContext();
    const finding = findFinding(ctx.projectUrl, issueId);

    const db = getDb();
    const existing = db.prepare("SELECT status, pr_url FROM code_fixes WHERE project_id = ? AND issue_id = ?").get(ctx.projectId, issueId) as
      | { status: string; pr_url: string | null }
      | undefined;
    if (existing && (existing.status === "pr_open" || existing.status === "merged")) {
      return NextResponse.json({ error: `Already has a real PR for this: ${existing.pr_url}`, prUrl: existing.pr_url }, { status: 409 });
    }
    if (existing && existing.status === "rejected") {
      return NextResponse.json({ error: "This fix was previously rejected — won't auto-retry. Delete that record to try again." }, { status: 409 });
    }

    const driver = getDriver(providerId);
    if (!driver) {
      return NextResponse.json({ error: `${providerId} isn't wired to a real model yet.` }, { status: 501 });
    }
    const connRow = db.prepare("SELECT api_key, base_url FROM provider_connections WHERE provider_id = ?").get(providerId) as
      | { api_key: string; base_url: string | null }
      | undefined;
    if (!connRow) {
      return NextResponse.json({ error: `${providerId} isn't connected yet. Connect it in Settings → LLM Providers.` }, { status: 422 });
    }

    const provider = getCodeFixProvider("contents-api", driver, connRow.api_key, model, connRow.base_url ?? undefined);
    const proposed = await provider.proposeFix(finding, ctx);

    return NextResponse.json({ finding, proposed });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to draft a fix." }, { status: 500 });
  }
}
