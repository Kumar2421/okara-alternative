import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { getRepo } from "@/lib/domain/codefix/githubApi";

/** Real, live check — confirms the PAT is valid and can actually see the
 * repo, before either is saved. Same honesty pattern as project creation's
 * URL-reachability check: don't save something that doesn't work. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const repo: string | undefined = body?.repo;

  if (!repo?.trim()) {
    return NextResponse.json({ error: "Repository is required." }, { status: 400 });
  }
  if (!/^[^/\\s]+\/[^/\\s]+$/.test(repo.trim())) {
    return NextResponse.json({ error: 'Repository must be "owner/repo" format.' }, { status: 400 });
  }

  try {
    let token = "";
    if (FEATURES.PLATFORM_MODE) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
      const db = (await import("@/utils/supabase/serviceClient")).createServiceClient();
      const { data: conn } = await db.from("provider_connections").select("api_key_secret_id").eq("user_id", user.id).eq("provider_id", "github").maybeSingle();
      if (!conn?.api_key_secret_id) return NextResponse.json({ error: "Connect GitHub with your account first." }, { status: 422 });
      const { data: secret } = await db.rpc("vault_get_secret", { p_id: conn.api_key_secret_id });
      token = (secret as string) ?? "";
      if (!token) return NextResponse.json({ error: "GitHub connection is missing a valid token. Reconnect GitHub." }, { status: 422 });
    } else {
      const pat: string | undefined = body?.pat;
      if (!pat?.trim()) return NextResponse.json({ error: "Token and repository are both required." }, { status: 400 });
      token = pat.trim();
    }

    const result = await getRepo(token, repo.trim());
    return NextResponse.json({ defaultBranch: result.defaultBranch, fullName: result.fullName });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't verify repo access." }, { status: 422 });
  }
}
