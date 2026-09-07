import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { SEOAgent } from "@/lib/domain/seo/SEOAgent";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body || !body.url) {
    return NextResponse.json({ error: "Missing URL in request body" }, { status: 400 });
  }

  const { url } = body as { url: string };

  try {
    const db = getDb();

    // Settings table (user-entered, via Settings → API Credentials)
    // takes priority; env var is a fallback for anyone running this outside the UI.
    const stored = db.prepare("SELECT value FROM settings WHERE key = 'pagespeed_api_key'").get() as
      | { value: string }
      | undefined;
    const pageSpeedApiKey = stored?.value || process.env.PAGESPEED_API_KEY || undefined;

    const agent = new SEOAgent(pageSpeedApiKey);
    const auditResult = await agent.audit(url);

    const createdAt = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO seo_audits (url, payload, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        payload = excluded.payload,
        created_at = excluded.created_at
    `).run(url, JSON.stringify(auditResult), createdAt);

    return NextResponse.json(auditResult);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");

  try {
    const db = getDb();
    
    if (url) {
      const audit = db.prepare("SELECT * FROM seo_audits WHERE url = ?").get(url);
      if (!audit) return NextResponse.json({ error: "No audit found for this URL" }, { status: 404 });
      return NextResponse.json(audit);
    } else {
      const audits = db.prepare("SELECT * FROM seo_audits ORDER BY created_at DESC").all();
      return NextResponse.json({ audits });
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
