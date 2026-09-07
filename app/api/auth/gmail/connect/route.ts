import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/domain/shared/gmailOAuth";

export async function GET(req: NextRequest) {
  const redirectUri = `${req.nextUrl.origin}/api/auth/gmail/callback`;
  try {
    return NextResponse.redirect(buildAuthUrl(redirectUri));
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(`${req.nextUrl.origin}/settings/api-credentials?gmail_error=${encodeURIComponent(raw)}`);
  }
}
