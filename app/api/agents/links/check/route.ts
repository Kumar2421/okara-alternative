import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { checkUrlReachable } from "@/lib/domain/shared/checkUrlReachable";

const CHECK_TIMEOUT_MS = 5000;
const MAX_LINKS_CHECKED = 20;

type CheckedLink = { href: string; text: string; internal: boolean; reachable: boolean; status?: number };

export async function GET() {
  const activeId = getActiveProjectId();
  if (!activeId) return NextResponse.json({ result: null });

  const db = getDb();
  const row = db.prepare("SELECT payload, checked_at FROM link_checks WHERE project_id = ?").get(activeId) as
    | { payload: string; checked_at: string }
    | undefined;

  if (!row) return NextResponse.json({ result: null });
  return NextResponse.json({ result: { links: JSON.parse(row.payload), checkedAt: row.checked_at } });
}

export async function POST() {
  const db = getDb();

  const activeId = getActiveProjectId();
  const project = activeId
    ? (db.prepare("SELECT url FROM projects WHERE id = ?").get(activeId) as { url: string } | undefined)
    : undefined;
  if (!activeId || !project || !project.url) {
    return NextResponse.json(
      { error: "No project website linked yet. Add one in the project switcher first." },
      { status: 422 }
    );
  }

  const auditRow = db.prepare("SELECT payload FROM seo_audits WHERE url = ?").get(project.url) as
    | { payload: string }
    | undefined;
  if (!auditRow) {
    return NextResponse.json(
      { error: "No crawl data for this site yet. Try refreshing the SEO audit first." },
      { status: 422 }
    );
  }
  const audit: SEOAuditPayload = JSON.parse(auditRow.payload);
  const candidateLinks = (audit.links ?? []).slice(0, MAX_LINKS_CHECKED);

  if (candidateLinks.length === 0) {
    return NextResponse.json({ result: { links: [], checkedAt: new Date().toISOString() } });
  }

  try {
    const checked: CheckedLink[] = await Promise.all(
      candidateLinks.map(async (link) => {
        const { reachable, status } = await checkUrlReachable(link.href, CHECK_TIMEOUT_MS);
        return { ...link, reachable, status };
      })
    );

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO link_checks (project_id, payload, checked_at) VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET payload = excluded.payload, checked_at = excluded.checked_at`
    ).run(activeId, JSON.stringify(checked), now);

    return NextResponse.json({ result: { links: checked, checkedAt: now } });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}
