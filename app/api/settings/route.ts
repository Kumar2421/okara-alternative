import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { redactSettingsForClient } from "@/lib/domain/shared/settingsRedaction";

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const settings = db.prepare("SELECT * FROM settings").all() as { key: string; value: string }[];
    return NextResponse.json({ settings: redactSettingsForClient(settings) });
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
