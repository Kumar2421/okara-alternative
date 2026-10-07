import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { assertPublicHttpUrl } from "@/lib/domain/seo/SEOAgent";
import { cmsFetch } from "@/lib/domain/cms/cmsFetch";
import { cmsNet } from "@/lib/cmsServer";

/** Real, live check against the WordPress REST API - same honesty pattern
 * as GitHub's validate route: never save a connection that doesn't
 * actually work. WordPress Application Passwords (core since 5.6): no
 * OAuth, no expiry, just username + generated app password, verified via
 * a real Basic-Auth call to /wp-json/wp/v2/users/me.
 * SSRF-safe: the call goes through cmsFetch (every redirect hop and DNS answer
 * is checked). Error text is generic: no network errors or response bodies are echoed. */
export async function POST(req: NextRequest) {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const siteUrl: string | undefined = body?.siteUrl;
  const username: string | undefined = body?.username;
  const appPassword: string | undefined = body?.appPassword;

  if (!siteUrl?.trim() || !username?.trim() || !appPassword?.trim()) {
    return NextResponse.json({ error: "Site URL, username, and application password are all required." }, { status: 400 });
  }

  let normalized: URL;
  try {
    normalized = new URL(siteUrl.trim().startsWith("http") ? siteUrl.trim() : `https://${siteUrl.trim()}`);
  } catch {
    return NextResponse.json({ error: "Invalid site URL." }, { status: 400 });
  }
  try {
    assertPublicHttpUrl(normalized.origin);
  } catch {
    return NextResponse.json({ error: "That site address can't be used." }, { status: 400 });
  }

  try {
    const auth = Buffer.from(`${username.trim()}:${appPassword.trim()}`).toString("base64");
    const res = await cmsFetch(
      `${normalized.origin}/wp-json/wp/v2/users/me`,
      { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } },
      { ...cmsNet, timeoutMs: 10_000 },
    );
    if (!res.ok) {
      if (res.status === 401) return NextResponse.json({ error: "Invalid username or application password." }, { status: 422 });
      return NextResponse.json({ error: "That site didn't accept the connection. Check the URL and that the REST API is enabled." }, { status: 422 });
    }
    const data = res.json() as { slug?: unknown } | null;
    return NextResponse.json({ siteUrl: normalized.origin, username: typeof data?.slug === "string" ? data.slug : username.trim() });
  } catch (err) {
    // CmsError text is generic by construction; anything else gets the fixed fallback.
    const e = err as { name?: string; message?: string } | null;
    const reason = e?.name === "CmsError" && e.message ? e.message : "Couldn't reach that site.";
    return NextResponse.json({ error: `${reason} Check the URL and that the REST API isn't disabled.` }, { status: 422 });
  }
}
