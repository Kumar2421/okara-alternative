import { NextRequest, NextResponse } from "next/server";
import { hostedContext, isHostedContext } from "@/lib/githubAppServer";
import { selectRepository } from "@/lib/domain/github/githubAppService";

/** Chooses the one repository this project's fixes go to (must be one the installation shares). */
export async function POST(req: NextRequest) {
  const ctx = await hostedContext();
  if (!isHostedContext(ctx)) return ctx;
  const body = await req.json().catch(() => null);
  try {
    const result = await selectRepository(ctx.deps, ctx.projectId, body?.repo);
    return result.ok ? NextResponse.json({ repoFullName: result.repoFullName }) : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't save the repository." }, { status: 502 });
  }
}
