import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST() {
  const db = getDb();
  for (const key of ["gcp_access_token", "gcp_refresh_token", "gcp_token_expiry", "gcp_email", "gcp_project_id"]) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }
  return NextResponse.json({ success: true });
}
