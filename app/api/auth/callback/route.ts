import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// Exchanges the OAuth `code` Supabase redirects back with for a session.
// Requires the provider (Google) to actually be enabled in the Supabase
// project's Auth settings — this route alone doesn't grant that.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextParam = request.nextUrl.searchParams.get("next");
  const base = request.nextUrl.origin;

  let destination = "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${base}/login?error=auth`);
    }
  }

  if (nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")) {
    destination = nextParam;
  }

  return NextResponse.redirect(`${base}${destination}`);
}
