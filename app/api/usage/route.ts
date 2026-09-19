import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

/** Real usage history + credit-cost reference for the Usage settings page.
 * Self-host has nothing to show here — no metering at all in the
 * bring-your-own-key model, so `available: false` tells the page to render
 * an honest "not applicable" state instead of an empty table. */
export async function GET() {
  if (!FEATURES.PLATFORM_MODE) {
    return NextResponse.json({ available: false });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = createServiceClient();
  const [{ data: profile }, { data: config }, { data: events, error: eventsError }, { data: costs }] = await Promise.all([
    db.from("profiles").select("credits_balance, plan_tier").eq("id", user.id).maybeSingle(),
    db.from("app_config").select("billing_enabled").eq("id", true).maybeSingle(),
    db
      .from("usage_events")
      .select("id, agent_type, model, tokens_in, tokens_out, credits_charged, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    db.from("credit_costs").select("agent_type, credits, description").order("agent_type"),
  ]);
  if (eventsError) return NextResponse.json({ error: eventsError.message }, { status: 500 });

  return NextResponse.json({
    available: true,
    balance: profile?.credits_balance ?? 0,
    planTier: profile?.plan_tier ?? "free",
    billingEnabled: config?.billing_enabled ?? false,
    events: events ?? [],
    costs: costs ?? [],
  });
}
