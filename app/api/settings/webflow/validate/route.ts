import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { cmsErrorResponse, cmsNet } from "@/lib/cmsServer";
import { listWebflowCollections, listWebflowSites } from "@/lib/domain/cms/webflowPublisher";

/**
 * Live check of a Webflow site API token, same honesty pattern as the WordPress validate route:
 * never save a connection that doesn't work. Without `siteId` it lists the sites the token can
 * see; with one it lists that site's CMS collections. Saves nothing and never echoes the token.
 */
export async function POST(req: NextRequest) {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const siteId = typeof body?.siteId === "string" ? body.siteId.trim() : "";
  if (!token || token.length > 500) return NextResponse.json({ error: "Enter your Webflow site API token." }, { status: 400 });
  if (siteId && !/^[A-Za-z0-9]{8,64}$/.test(siteId)) return NextResponse.json({ error: "Invalid site." }, { status: 400 });
  try {
    if (siteId) return NextResponse.json({ collections: await listWebflowCollections(token, siteId, cmsNet) });
    const sites = await listWebflowSites(token, cmsNet);
    if (sites.length === 0) return NextResponse.json({ error: "That token can't see any sites. Create a site token from the site's settings." }, { status: 422 });
    return NextResponse.json({ sites });
  } catch (err) {
    return cmsErrorResponse(err, "Couldn't verify the Webflow token.");
  }
}
