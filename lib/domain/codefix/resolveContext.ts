import { getDb } from "@/lib/db";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import type { Finding, SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";
import type { CodeFixContext } from "@/lib/domain/codefix/types";

type ProjectRow = { id: string; name: string; category: string; description: string; url: string };

/** Assembles the real, minimal context the fix agent needs — active
 * project's identity/URL plus the GitHub PAT+repo from settings. Throws a
 * specific, actionable error for each missing piece rather than a generic
 * 422, since there are three independent real prerequisites here. */
export function resolveCodeFixContext(): CodeFixContext {
  const db = getDb();
  const activeId = getActiveProjectId();
  if (!activeId) throw new Error("No active project — add a website first.");

  const project = db.prepare("SELECT id, name, category, description, url FROM projects WHERE id = ?").get(activeId) as
    | ProjectRow
    | undefined;
  if (!project) throw new Error("No active project — add a website first.");

  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('github_pat', 'github_repo')").all() as {
    key: string;
    value: string;
  }[];
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  if (!map.github_pat || !map.github_repo) {
    throw new Error("GitHub isn't connected — connect it in Settings → API Credentials.");
  }

  return {
    projectId: project.id,
    projectName: project.name,
    projectUrl: project.url,
    repoFullName: map.github_repo,
    githubToken: map.github_pat,
  };
}

/** Finding lives inside the most recent seo_audits row for this project's
 * URL — same table the SEO tab already reads, no duplicate storage. */
export function findFinding(projectUrl: string, issueId: string): Finding {
  const db = getDb();
  const row = db.prepare("SELECT payload FROM seo_audits WHERE url = ?").get(projectUrl) as { payload: string } | undefined;
  if (!row) throw new Error("No SEO audit found for this project yet — run one in Analytics → SEO first.");

  const payload = JSON.parse(row.payload) as SEOAuditPayload;
  const finding = payload.findings?.find((f) => f.issueId === issueId);
  if (!finding) throw new Error("That finding wasn't found in the latest audit — it may have already been fixed. Re-run the audit.");
  if (!finding.autoFixable) throw new Error("This finding isn't eligible for an automatic code fix.");
  return finding;
}
