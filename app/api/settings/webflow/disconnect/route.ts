import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { disconnectHostedProvider } from "@/lib/hostedConnections";
import { WEBFLOW_CONFIG_SETTING } from "@/lib/cmsServer";

/** Disconnects Webflow immediately: the saved token reference and the site/collection choice are removed, so no further change can be made. Hosted mode also deletes the Vault secret. */
export async function POST() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const result = await disconnectHostedProvider(user.id, "webflow", [WEBFLOW_CONFIG_SETTING]);
    if (!result.ok) return NextResponse.json({ error: "Couldn't disconnect Webflow. Try again." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  const db = getDb();
  db.prepare("DELETE FROM provider_connections WHERE provider_id = 'webflow'").run();
  db.prepare("DELETE FROM settings WHERE key = ?").run(WEBFLOW_CONFIG_SETTING);
  return NextResponse.json({ ok: true });
}
