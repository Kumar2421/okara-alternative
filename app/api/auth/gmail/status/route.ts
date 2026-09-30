import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { getDb } from "@/lib/db";

export async function GET() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ connected: false }, { status: 401 });

    const db = createServiceClient();
    const { data } = await db
      .from("integration_connections")
      .select("external_email, updated_at")
      .eq("user_id", user.id)
      .eq("provider", "gmail")
      .is("project_id", null)
      .maybeSingle();

    return NextResponse.json({
      connected: Boolean(data),
      email: data?.external_email ?? null,
      updatedAt: data?.updated_at ?? null,
      mode: "platform",
    });
  }

  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM settings WHERE key = 'gmail_email'")
    .all() as { key: string; value: string }[];
  const email = rows[0]?.value ?? null;
  return NextResponse.json({ connected: Boolean(email), email, mode: "self-host" });
}