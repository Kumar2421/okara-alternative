import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST() {
  const db = getDb();
  for (const key of [
    "ga_access_token",
    "ga_refresh_token",
    "ga_token_expiry",
    "ga_email",
    "gsc_site_url",
    "ga_property_id",
    "ga_property_name",
  ]) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }
  return NextResponse.json({ success: true });
}
