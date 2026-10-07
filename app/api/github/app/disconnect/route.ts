import { NextResponse } from "next/server";
import { hostedContext, isHostedContext } from "@/lib/githubAppServer";
import { disconnectGithubApp } from "@/lib/domain/github/githubAppService";

/** Removes Marlo's access immediately. Pull requests already opened stay open on GitHub. */
export async function POST() {
  const ctx = await hostedContext();
  if (!isHostedContext(ctx)) return ctx;
  try {
    const { uninstalled } = await disconnectGithubApp(ctx.deps, ctx.projectId);
    return NextResponse.json({ ok: true, uninstalled });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't disconnect GitHub." }, { status: 500 });
  }
}
