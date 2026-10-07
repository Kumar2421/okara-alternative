import { NextRequest, NextResponse } from "next/server";
import { hostedContext, isHostedContext, SETTINGS_PATH } from "@/lib/githubAppServer";
import { safeReturnPath } from "@/lib/domain/github/githubApp";
import { startInstall } from "@/lib/domain/github/githubAppService";

/** Starts the GitHub App installation: a signed state bound to this user and project, then GitHub. */
export async function GET(req: NextRequest) {
  const ctx = await hostedContext();
  const back = (message: string) => NextResponse.redirect(`${req.nextUrl.origin}${SETTINGS_PATH}?github_error=${encodeURIComponent(message)}`);
  if (!isHostedContext(ctx)) {
    const body = (await ctx.json().catch(() => null)) as { error?: string } | null;
    return back(body?.error ?? "Couldn't start the GitHub connection.");
  }
  const started = startInstall(ctx.cfg, { userId: ctx.userId, projectId: ctx.projectId, returnTo: safeReturnPath(req.nextUrl.searchParams.get("returnTo")) });
  return started.ok ? NextResponse.redirect(started.url) : back(started.error);
}
