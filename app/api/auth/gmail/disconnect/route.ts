import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST() {
  const db = getDb();
  for (const key of ["gmail_access_token", "gmail_refresh_token", "gmail_token_expiry", "gmail_email"]) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }
  return NextResponse.json({ success: true });
}
