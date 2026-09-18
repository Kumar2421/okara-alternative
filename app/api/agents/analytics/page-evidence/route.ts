import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { SEOAgent } from "@/lib/domain/seo/SEOAgent";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const pageUrl = typeof body?.url === "string" ? body.url.trim() : "";

  if (!pageUrl) {
    return NextResponse.json({ error: "Missing page URL." }, { status: 400 });
  }

  const projectId = getActiveProjectId();
  if (!projectId) {
    return NextResponse.json({ error: "No active project." }, { status: 422 });
  }

  const db = getDb();
  const project = db.prepare("SELECT url FROM projects WHERE id = ?").get(projectId) as
    | { url: string }
    | undefined;

  if (!project?.url) {
    return NextResponse.json({ error: "Active project has no website URL." }, { status: 422 });
  }

  let projectOrigin: URL;
  let target: URL;
  try {
    projectOrigin = new URL(project.url);
    target = new URL(pageUrl);
  } catch {
    return NextResponse.json({ error: "Invalid project or page URL." }, { status: 400 });
  }

  if (target.protocol !== projectOrigin.protocol || target.hostname !== projectOrigin.hostname) {
    return NextResponse.json(
      { error: "Ranking page must belong to the active project website." },
      { status: 403 }
    );
  }

  try {
    const audit = await new SEOAgent().audit(target.toString());

    return NextResponse.json({
      url: audit.url,
      meta: audit.meta,
      headings: audit.headings,
      contentRelevance: audit.contentRelevance,
      technical: {
        status: audit.technical.status,
        redirectCount: audit.technical.redirectCount,
      },
      serverTiming: audit.serverTiming,
      links: {
        internal: audit.links.filter((link) => link.internal).length,
        external: audit.links.filter((link) => !link.internal).length,
      },
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}
