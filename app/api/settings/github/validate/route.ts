import { NextRequest, NextResponse } from "next/server";
import { getRepo } from "@/lib/domain/codefix/githubApi";

/** Real, live check — confirms the PAT is valid and can actually see the
 * repo, before either is saved. Same honesty pattern as project creation's
 * URL-reachability check: don't save something that doesn't work. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const pat: string | undefined = body?.pat;
  const repo: string | undefined = body?.repo;

  if (!pat?.trim() || !repo?.trim()) {
    return NextResponse.json({ error: "Token and repository are both required." }, { status: 400 });
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo.trim())) {
    return NextResponse.json({ error: 'Repository must be "owner/repo" format.' }, { status: 400 });
  }

  try {
    const result = await getRepo(pat.trim(), repo.trim());
    return NextResponse.json({ defaultBranch: result.defaultBranch, fullName: result.fullName });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't verify repo access." }, { status: 422 });
  }
}
