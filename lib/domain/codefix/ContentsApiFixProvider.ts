import type { LlmDriver } from "@/lib/llm";
import type { Finding } from "@/lib/domain/seo/SEOAgent";
import type { CodeFixContext, CodeFixProvider, ProposedFix } from "@/lib/domain/codefix/types";
import { getRepo, searchCode, getFileContent, createBranch, putFileContent, createPullRequest } from "@/lib/domain/codefix/githubApi";

/** Finds the real source file most likely to render `projectUrl`'s path —
 * grounded in GitHub's real Code Search, never guessed. Homepage is tried
 * against common framework conventions directly (no search term to anchor
 * on for "/"); throws honestly if nothing matches rather than picking a
 * random file. */
async function locateFile(token: string, repoFullName: string, defaultBranch: string, projectUrl: string): Promise<string> {
  const pathname = new URL(projectUrl).pathname.replace(/\/+$/, "");

  if (!pathname) {
    const candidates = ["app/page.tsx", "app/page.jsx", "src/app/page.tsx", "pages/index.tsx", "pages/index.jsx", "index.html"];
    for (const candidate of candidates) {
      try {
        await getFileContent(token, repoFullName, candidate, defaultBranch);
        return candidate;
      } catch {
        continue;
      }
    }
    throw new Error("Couldn't locate the homepage file automatically — none of the common framework paths matched. Fix it manually.");
  }

  const segment = pathname.split("/").filter(Boolean).pop()!;
  const results = await searchCode(token, repoFullName, `in:path ${segment}`);
  if (results.length === 0) {
    throw new Error(`Couldn't find a file matching "${pathname}" in ${repoFullName} — search didn't return anything. Fix it manually.`);
  }
  const best = results.find((r) => r.path.includes(`/${segment}/`) || r.path.includes(`/${segment}.`)) ?? results[0];
  return best.path;
}

type ParsedPatch = { old: string; new: string; explanation: string };

/** Parses the fixed OLD/NEW/EXPLANATION format the LLM is instructed to
 * return — a strict find-replace, not "regenerate the whole file", so a
 * small model can't silently corrupt unrelated content. */
function parsePatchResponse(raw: string): ParsedPatch {
  const oldMatch = raw.match(/OLD:\s*\n?<<<\n?([\s\S]*?)\n?>>>/);
  const newMatch = raw.match(/NEW:\s*\n?<<<\n?([\s\S]*?)\n?>>>/);
  const explanationMatch = raw.match(/EXPLANATION:\s*(.+)/);

  if (!oldMatch || !newMatch) {
    throw new Error("Model didn't return a parseable fix — try again.");
  }
  return {
    old: oldMatch[1],
    new: newMatch[1],
    explanation: explanationMatch?.[1]?.trim() ?? "Fixes the reported issue.",
  };
}

/**
 * Real implementation of CodeFixProvider for v1's scope (single-tag/single-
 * line fixes): read the real file via Contents API, have the LLM produce a
 * strict find-replace patch (not a full-file rewrite), verify the OLD block
 * actually exists in the file before trusting it, then push via a new
 * branch + draft PR. No repo clone, no build/test execution — see
 * types.ts's CodeFixProvider doc for why (and the future OpenHands seam).
 */
export class ContentsApiFixProvider implements CodeFixProvider {
  constructor(private llmDriver: LlmDriver, private llmApiKey: string, private llmModel: string, private llmBaseUrl?: string) {}

  async proposeFix(finding: Finding, ctx: CodeFixContext): Promise<ProposedFix> {
    const repo = await getRepo(ctx.githubToken, ctx.repoFullName);
    const filePath = await locateFile(ctx.githubToken, ctx.repoFullName, repo.defaultBranch, ctx.projectUrl);
    const file = await getFileContent(ctx.githubToken, ctx.repoFullName, filePath, repo.defaultBranch);

    const system = `You are a senior engineer making one small, surgical fix to a real source file for a real SEO issue. Output ONLY the exact format requested, nothing else. Never touch anything unrelated to this one issue.`;
    const prompt = `Repo: ${ctx.repoFullName}
File: ${filePath}
Issue: ${finding.label} (category: ${finding.category})
Evidence: ${JSON.stringify(finding.evidence)}
Product: ${ctx.projectName} — ${ctx.projectUrl}

Current file content:
"""
${file.content}
"""

Return the fix in exactly this format, nothing else:
OLD:
<<<
(a short substring copied VERBATIM from the file above — either the exact tag/line to replace, or an exact anchor line like </head> to insert new content right before)
>>>
NEW:
<<<
(what OLD becomes — the fixed or inserted content)
>>>
EXPLANATION: <one sentence, for the PR description>

The OLD block must exist character-for-character in the file above — copy it exactly, do not paraphrase or reformat it.`;

    const result = await this.llmDriver({
      apiKey: this.llmApiKey,
      model: this.llmModel,
      system,
      messages: [{ role: "user", content: prompt }],
      baseUrl: this.llmBaseUrl,
    });

    const parsed = parsePatchResponse(result.text ?? "");
    if (!file.content.includes(parsed.old)) {
      throw new Error("Generated fix didn't match the real file content exactly — the model may have paraphrased. Try again.");
    }

    const after = file.content.replace(parsed.old, parsed.new);
    return {
      filePath,
      before: file.content,
      after,
      oldSnippet: parsed.old,
      newSnippet: parsed.new,
      explanation: parsed.explanation,
      applyToken: file.sha,
    };
  }

  async applyFix(fix: ProposedFix, ctx: CodeFixContext, finding: Finding): Promise<{ prUrl: string; branch: string }> {
    const repo = await getRepo(ctx.githubToken, ctx.repoFullName);
    const branch = `fix/${finding.issueId}-${Date.now().toString(36)}`;

    await createBranch(ctx.githubToken, ctx.repoFullName, repo.defaultBranch, branch);
    await putFileContent(ctx.githubToken, ctx.repoFullName, fix.filePath, fix.after, `fix: ${finding.label}`, branch, fix.applyToken!);

    const prUrl = await createPullRequest(
      ctx.githubToken,
      ctx.repoFullName,
      `fix: ${finding.label}`,
      `${fix.explanation}\n\nAutomatically generated from a real SEO audit finding on ${ctx.projectUrl}.\n\n**File:** \`${fix.filePath}\`\n**Issue:** ${finding.label}\n\nOpened as a draft — review before merging.`,
      branch,
      repo.defaultBranch
    );

    return { prUrl, branch };
  }
}
