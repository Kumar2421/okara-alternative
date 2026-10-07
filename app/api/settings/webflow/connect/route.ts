import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { cmsErrorResponse, cmsNet, WEBFLOW_CONFIG_SETTING, type WebflowSelection } from "@/lib/cmsServer";
import { listWebflowCollections, listWebflowSites } from "@/lib/domain/cms/webflowPublisher";

/**
 * Saves a Webflow connection after re-validating it live. The token goes to the same secret store
 * the other integrations use (Vault in hosted mode via vault_set_secret, the local
 * provider_connections row when self-hosting); only the non-secret site/collection choice is kept
 * as a setting. The token is never logged or returned.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const siteId = typeof body?.siteId === "string" ? body.siteId.trim() : "";
  const collectionId = typeof body?.collectionId === "string" ? body.collectionId.trim() : "";
  if (!token || !siteId || !collectionId) return NextResponse.json({ error: "Token, site and collection are all required." }, { status: 400 });

  let userId: string | null = null;
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    userId = user.id;
  }

  let selection: WebflowSelection;
  try {
    const site = (await listWebflowSites(token, cmsNet)).find((s) => s.id === siteId);
    if (!site) return NextResponse.json({ error: "That site isn't available to this token." }, { status: 422 });
    const collection = (await listWebflowCollections(token, siteId, cmsNet)).find((c) => c.id === collectionId);
    if (!collection) return NextResponse.json({ error: "That collection wasn't found on the site." }, { status: 422 });
    selection = { siteId, siteName: site.name, collectionId, collectionName: collection.name };
  } catch (err) {
    return cmsErrorResponse(err, "Couldn't verify the Webflow token.");
  }
  const config = JSON.stringify(selection);
  const now = new Date().toISOString();

  if (userId) {
    const db = createServiceClient();
    const { data: secretId, error: secretError } = await db.rpc("vault_set_secret", { p_secret: token, p_name: `provider_key:${userId}:webflow` });
    if (secretError) return NextResponse.json({ error: "Couldn't store the token securely." }, { status: 500 });
    const { error } = await db.from("provider_connections").upsert(
      { user_id: userId, provider_id: "webflow", base_url: null, key_preview: "••••", connected_at: now, api_key_secret_id: secretId as string },
      { onConflict: "user_id,provider_id" },
    );
    if (error) return NextResponse.json({ error: "Couldn't save the connection." }, { status: 500 });
    const { error: settingError } = await db.from("user_settings").upsert({ user_id: userId, key: WEBFLOW_CONFIG_SETTING, value: config, updated_at: now }, { onConflict: "user_id,key" });
    if (settingError) return NextResponse.json({ error: "Couldn't save the connection." }, { status: 500 });
  } else {
    const db = getDb();
    db.prepare(
      `INSERT INTO provider_connections (provider_id, api_key, base_url, connected_at) VALUES ('webflow', @token, NULL, @now)
       ON CONFLICT(provider_id) DO UPDATE SET api_key = @token, base_url = NULL, connected_at = @now`,
    ).run({ token, now });
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(WEBFLOW_CONFIG_SETTING, config);
  }
  return NextResponse.json({ ok: true, siteName: selection.siteName, collectionName: selection.collectionName });
}
