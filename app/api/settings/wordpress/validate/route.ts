import { NextRequest, NextResponse } from "next/server";

/** Real, live check against the WordPress REST API — same honesty pattern
 * as GitHub's validate route: never save a connection that doesn't
 * actually work. WordPress Application Passwords (core since 5.6) — no
 * OAuth, no expiry, just username + generated app password, verified via
 * a real Basic-Auth call to /wp-json/wp/v2/users/me. */
export async function POST(req: NextRequest) {
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
    const auth = Buffer.from(`${username.trim()}:${appPassword.trim()}`).toString("base64");
    const res = await fetch(`${normalized.origin}/wp-json/wp/v2/users/me`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      if (res.status === 401) return NextResponse.json({ error: "Invalid username or application password." }, { status: 422 });
      return NextResponse.json({ error: `WordPress site responded with HTTP ${res.status}.` }, { status: 422 });
    }
    const data = await res.json();
    return NextResponse.json({ siteUrl: normalized.origin, username: data.slug ?? username.trim() });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Couldn't reach ${normalized.origin} — check the URL and that REST API isn't disabled. (${raw})` }, { status: 422 });
  }
}
