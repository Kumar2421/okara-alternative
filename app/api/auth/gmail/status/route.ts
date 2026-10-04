import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { getDb } from "@/lib/db";
import { gmailCapabilities } from "@/lib/domain/shared/gmailCapabilities";

export async function GET() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ connected: false }, { status: 401 });

    const db = createServiceClient();
    const { data } = await db
      .from("integration_connections")
      .select("external_email, updated_at, scopes")
      .eq("user_id", user.id)
      .eq("provider", "gmail")
      .is("project_id", null)
      .maybeSingle();

    return NextResponse.json({
      connected: Boolean(data),
      email: data?.external_email ?? null,
      updatedAt: data?.updated_at ?? null,
      ...gmailCapabilities(data?.scopes),
      mode: "platform",
    });
  }

  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM settings WHERE key = 'gmail_email'")
    .all() as { key: string; value: string }[];
  const email = rows[0]?.value ?? null;
  // Self-host asks for both Gmail scopes in its own consent flow, so there is nothing to narrow here.
  return NextResponse.json({ connected: Boolean(email), email, canSend: true, canRead: true, known: false, mode: "self-host" });
}