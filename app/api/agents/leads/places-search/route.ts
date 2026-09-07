import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { searchLocalBusinesses } from "@/lib/domain/leads/PlacesAgent";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const category: string = typeof body?.category === "string" ? body.category.trim() : "";
  const location: string = typeof body?.location === "string" ? body.location.trim() : "";

  if (!category || !location) {
    return NextResponse.json({ error: "Enter both a category and a location." }, { status: 400 });
  }

  const db = getDb();

  const googleKeyRow = db.prepare("SELECT value FROM settings WHERE key = 'google_cloud_api_key'").get() as
    | { value: string }
    | undefined;
  if (!googleKeyRow?.value) {
    return NextResponse.json(
      { error: "Connect a Google Cloud API key in Settings → API Credentials (with Places API enabled) to search local businesses." },
      { status: 422 }
    );
  }

  const activeId = getActiveProjectId();
  if (!activeId) {
    return NextResponse.json({ error: "No active project. Link a website first." }, { status: 422 });
  }

  try {
    const businesses = await searchLocalBusinesses(googleKeyRow.value, { category, location });

    const now = new Date().toISOString();
    const query = `${category} in ${location}`;
    const insert = db.prepare(
      `INSERT INTO leads (id, project_id, name, location, phone, source_url, place_id, lead_type, query, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'business', ?, ?)`
    );
    const saved = businesses.map((biz) => {
      const id = `lead_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      insert.run(id, activeId, biz.name, location, biz.phone, biz.website, biz.placeId, query, now);
      return {
        id,
        project_id: activeId,
        name: biz.name,
        location,
        phone: biz.phone,
        source_url: biz.website,
        place_id: biz.placeId,
        lead_type: "business",
        query,
        created_at: now,
      };
    });

    return NextResponse.json({ leads: saved });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: raw }, { status: 502 });
  }
}
