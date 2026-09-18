import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const settings = db.prepare("SELECT key, value FROM settings WHERE key NOT IN ('ga_access_token', 'ga_refresh_token', 'ga_token_expiry')").all();
    return NextResponse.json({ settings });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { key, value } = body;
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });
  if ([
    "ga_access_token",
    "ga_refresh_token",
    "ga_token_expiry",
    "ga_email",
    "gsc_site_url",
    "ga_property_id",
    "ga_property_name",
  ].includes(key)) {
    return NextResponse.json({ error: "Google connection data is project-scoped and cannot be stored in generic settings." }, { status: 400 });
  }

  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
    return NextResponse.json({ success: true });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 500 });
  }
}
