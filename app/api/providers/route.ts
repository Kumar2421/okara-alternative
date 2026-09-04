import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * Provider connection registry, backed by local SQLite (see lib/db.ts for why).
 * Single-user, single-machine for now — no per-user scoping because there is no
 * auth yet. Once auth exists, add a user_id column and scope every query to it.
 */

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare("SELECT provider_id, api_key, base_url, connected_at FROM provider_connections")
    .all() as { provider_id: string; api_key: string; base_url: string | null; connected_at: string }[];

  const connections = rows.map((r) => ({
    providerId: r.provider_id,
    connectedAt: r.connected_at,
    baseUrl: r.base_url ?? undefined,
    // never return the raw key to the client — empty string means "no key
    // needed" (local servers), not "key hidden"
    keyPreview: r.api_key ? `${r.api_key.slice(0, 4)}••••${r.api_key.slice(-2)}` : "",
  }));

  const primaryModel = db.prepare("SELECT value FROM settings WHERE key = 'primaryModel'").get() as
    | { value: string }
    | undefined;

  return NextResponse.json({ connections, primaryModel: primaryModel?.value ?? null });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.providerId !== "string") {
    return NextResponse.json({ error: "providerId is required" }, { status: 400 });
  }

  const apiKey: string = typeof body.apiKey === "string" ? body.apiKey : "";
  const baseUrl: string | null = typeof body.baseUrl === "string" && body.baseUrl.trim() ? body.baseUrl.trim() : null;

  // A connection needs either a real key or a base URL (local servers use a
  // URL with no key) — reject only if both are missing.
  if (!apiKey.trim() && !baseUrl) {
    return NextResponse.json({ error: "Provide an API key or a base URL" }, { status: 400 });
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO provider_connections (provider_id, api_key, base_url, connected_at)
     VALUES (@providerId, @apiKey, @baseUrl, @connectedAt)
     ON CONFLICT(provider_id) DO UPDATE SET api_key = @apiKey, base_url = @baseUrl, connected_at = @connectedAt`
  ).run({ providerId: body.providerId, apiKey, baseUrl, connectedAt: new Date().toISOString() });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const providerId = searchParams.get("providerId");
  if (!providerId) {
    return NextResponse.json({ error: "providerId query param is required" }, { status: 400 });
  }

  const db = getDb();
  db.prepare("DELETE FROM provider_connections WHERE provider_id = ?").run(providerId);

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.primaryModel !== "string") {
    return NextResponse.json({ error: "primaryModel is required" }, { status: 400 });
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('primaryModel', @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`
  ).run({ value: body.primaryModel });

  return NextResponse.json({ ok: true });
}
