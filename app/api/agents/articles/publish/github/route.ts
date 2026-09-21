import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";
import { getRepo, createBranch, putFileContent, createPullRequest } from "@/lib/domain/codefix/githubApi";

function parseTitle(raw: string): string | null {
  const match = raw.match(/^---\s*\ntitle:\s*(.*)\n/);
  return match ? match[1].trim() : null;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "article";
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id: string | undefined = body?.id;
  if (!id) return NextResponse.json({ error: "Missing article id" }, { status: 400 });

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();

    const { data: article } = await db
      .from("articles")
      .select("id, topic, title, content")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!article) return NextResponse.json({ error: "Article not found." }, { status: 404 });

    // Same storage convention as codefix propose/apply: PAT in
    // provider_connections (Vault), repo full name in user_settings.
    const { data: githubConn } = await db
      .from("provider_connections")
      .select("api_key_secret_id")
      .eq("user_id", user.id)
      .eq("provider_id", "github")
      .maybeSingle();
    const { data: repoSetting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "github_repo")
      .maybeSingle();
    if (!githubConn?.api_key_secret_id || !repoSetting?.value) {
      return NextResponse.json({ error: "GitHub isn't connected — connect it in Settings → Integrations." }, { status: 422 });
    }
    const { data: secret } = await db.rpc("vault_get_secret", { p_id: githubConn.api_key_secret_id });
    const token = (secret as string) ?? "";
    if (!token) return NextResponse.json({ error: "GitHub isn't connected — connect it in Settings → Integrations." }, { status: 422 });

    try {
      const title = parseTitle(article.content) ?? article.title ?? article.topic;
      const repo = await getRepo(token, repoSetting.value);
      const slug = slugify(title);
      const branch = `article/${slug}-${Date.now().toString(36)}`;
      await createBranch(token, repo.fullName, repo.defaultBranch, branch);
      await putFileContent(token, repo.fullName, `content/articles/${slug}.md`, article.content, `Add article: ${title}`, branch);
      const prUrl = await createPullRequest(
        token,
        repo.fullName,
        `New article: ${title}`,
        `Auto-generated article ready for review.\n\nTopic: ${article.topic}`,
        branch,
        repo.defaultBranch
      );

      await db.from("articles").update({ status: "pr_open", pr_url: prUrl, published_at: new Date().toISOString() }).eq("id", id);

      return NextResponse.json({ prUrl });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to open PR." }, { status: 500 });
    }
  }

  try {
    const db = getDb();
    const article = db.prepare("SELECT id, topic, title, content FROM articles WHERE id = ?").get(id) as
      | { id: string; topic: string; title: string | null; content: string }
      | undefined;
    if (!article) return NextResponse.json({ error: "Article not found." }, { status: 404 });

    const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('github_pat', 'github_repo')").all() as {
      key: string;
      value: string;
    }[];
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    if (!map.github_pat || !map.github_repo) {
      return NextResponse.json({ error: "GitHub isn't connected — connect it in Settings → Integrations." }, { status: 422 });
    }

    const title = parseTitle(article.content) ?? article.title ?? article.topic;
    const repo = await getRepo(map.github_pat, map.github_repo);
    const slug = slugify(title);
    const branch = `article/${slug}-${Date.now().toString(36)}`;
    await createBranch(map.github_pat, repo.fullName, repo.defaultBranch, branch);
    await putFileContent(map.github_pat, repo.fullName, `content/articles/${slug}.md`, article.content, `Add article: ${title}`, branch);
    const prUrl = await createPullRequest(
      map.github_pat,
      repo.fullName,
      `New article: ${title}`,
      `Auto-generated article ready for review.\n\nTopic: ${article.topic}`,
      branch,
      repo.defaultBranch
    );

    db.prepare("UPDATE articles SET status = 'pr_open', pr_url = ?, published_at = ? WHERE id = ?").run(prUrl, new Date().toISOString(), id);

    return NextResponse.json({ prUrl });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to open PR." }, { status: 500 });
  }
}
