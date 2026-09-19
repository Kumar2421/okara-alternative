import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

/** Real credit balance + billing-enforcement state for the current user.
 * Self-host has no metering at all (bring-your-own-key model) — balance is
 * null there, the UI hides the credits pill entirely rather than showing a
 * meaningless number. Platform mode always has a real balance; whether it's
 * actually enforced depends on app_config.billing_enabled (off during beta —
 * see migration 12_billing_toggle — so spend_credits() still meters every
 * action for real, it just never blocks). */
export async function GET() {
  if (!FEATURES.PLATFORM_MODE) {
    return NextResponse.json({ balance: null, billingEnabled: false });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const db = createServiceClient();
  const [{ data: profile }, { data: config }] = await Promise.all([
    db.from("profiles").select("credits_balance").eq("id", user.id).maybeSingle(),
    db.from("app_config").select("billing_enabled").eq("id", true).maybeSingle(),
  ]);

  return NextResponse.json({
    balance: profile?.credits_balance ?? 0,
    billingEnabled: config?.billing_enabled ?? false,
  });
}
