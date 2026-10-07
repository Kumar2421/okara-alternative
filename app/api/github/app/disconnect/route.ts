import { NextResponse } from "next/server";
import { hostedContext, isHostedContext } from "@/lib/githubAppServer";
import { disconnectGithubApp } from "@/lib/domain/github/githubAppService";

/** Clears Marlo's link immediately (the GitHub App itself stays installed until the owner removes it in GitHub settings). Pull requests already opened stay open on GitHub. */
export async function POST() {
  const ctx = await hostedContext();
  if (!isHostedContext(ctx)) return ctx;
  try {
    await disconnectGithubApp(ctx.deps, ctx.projectId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't disconnect GitHub." }, { status: 500 });
  }
}
