import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";
import { getPlatformRuntimeConfig } from "@/lib/platform/runtimeConfig";

export async function proxy(request: NextRequest) {
  const runtime = getPlatformRuntimeConfig();

  // Hosted/platform mode must fail closed when its runtime contract is not
  // configured. This prevents auth/database requests from falling through to
  // an incomplete deployment.
  if (runtime.platformMode && runtime.missing.length > 0) {
    return new NextResponse("Platform runtime is not configured.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (!runtime.platformMode) {
    return NextResponse.next();
  }

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|lottie)$).*)",
  ],
};
