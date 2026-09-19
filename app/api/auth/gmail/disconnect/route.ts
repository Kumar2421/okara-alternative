import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function POST() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { error } = await db
      .from("integration_connections")
      .delete()
      .eq("user_id", user.id)
      .eq("provider", "gmail");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  }

  const db = getDb();
  for (const key of ["gmail_access_token", "gmail_refresh_token", "gmail_token_expiry", "gmail_email"]) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }
  return NextResponse.json({ success: true });
}
