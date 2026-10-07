import { NextRequest, NextResponse } from "next/server";
import { hostedContext, isHostedContext, SETTINGS_PATH } from "@/lib/githubAppServer";
import { completeInstall } from "@/lib/domain/github/githubAppService";

/** GitHub sends the user back here after installing (set this as both the Callback URL and the Setup URL). */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const fail = (message: string) => NextResponse.redirect(`${origin}${SETTINGS_PATH}?github_error=${encodeURIComponent(message)}`);
  const ctx = await hostedContext();
  if (!isHostedContext(ctx)) {
    const body = (await ctx.json().catch(() => null)) as { error?: string } | null;
    return fail(body?.error ?? "Couldn't finish the GitHub connection.");
  }
  const params = req.nextUrl.searchParams;
  if (params.get("setup_action") === "request") return fail("The GitHub organization owner still has to approve the installation.");
  try {
    const result = await completeInstall(ctx.deps, {
      userId: ctx.userId,
      state: params.get("state"),
      installationId: params.get("installation_id"),
      code: params.get("code"),
    });
    if (!result.ok) return fail(result.error);
    const target = new URL(result.returnTo ?? `${SETTINGS_PATH}?github=connected`, origin);
    target.searchParams.set("github", "connected");
    return NextResponse.redirect(target);
  } catch {
    return fail("Couldn't finish the GitHub connection. Please try again.");
  }
}
