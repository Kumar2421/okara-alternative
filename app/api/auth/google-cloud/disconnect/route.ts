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
      .eq("provider", "gcp");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Cleanup the created-API-key pointer too (see settings/google-cloud/
    // create-key/route.ts) — the vault row it points at is left orphaned,
    // same as the OAuth token secrets above.
    await db
      .from("user_settings")
      .delete()
      .eq("user_id", user.id)
      .eq("key", "google_cloud_api_key_secret_id");

    return NextResponse.json({ success: true });
  }

  const db = getDb();
  for (const key of ["gcp_access_token", "gcp_refresh_token", "gcp_token_expiry", "gcp_email", "gcp_project_id"]) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }
  return NextResponse.json({ success: true });
}
