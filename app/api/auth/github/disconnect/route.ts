import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

export async function POST() {
  if (!FEATURES.PLATFORM_MODE) return NextResponse.json({ ok: true });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const db = createServiceClient();
  const { error } = await db.from("provider_connections").delete().eq("user_id", user.id).eq("provider_id", "github");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await db.from("user_settings").delete().eq("user_id", user.id).eq("key", "github_repo");
  return NextResponse.json({ ok: true });
}
