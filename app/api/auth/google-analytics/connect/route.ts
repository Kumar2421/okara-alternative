import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/domain/shared/googleAnalyticsOAuth";

export async function GET(req: NextRequest) {
  const redirectUri = `${req.nextUrl.origin}/api/auth/google-analytics/callback`;
  // "return" carries where to send the user back to after consent — the
  // Settings card and the AnalyticsPanel's inline Connect both use this
  // route, and they want different landing pages.
  const returnTo = req.nextUrl.searchParams.get("return") === "dashboard" ? "dashboard" : "settings";
  try {
    return NextResponse.redirect(buildAuthUrl(redirectUri, returnTo));
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(`${req.nextUrl.origin}/settings/api-credentials?ga_error=${encodeURIComponent(raw)}`);
  }
}
