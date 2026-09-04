import type { LlmDriver, CompletionResult } from "@/lib/llm";
import type { SEOAuditPayload } from "@/lib/domain/seo/SEOAgent";

export type GitHubRequest = {
  repo: string;
  audit: SEOAuditPayload;
  model: string;
};

/**
 * Drafts a PR description + suggested code changes from real SEO audit
 * findings. Does NOT open a real pull request yet — that needs a real GitHub
 * token + @octokit/rest write access, which is a bigger scope than "draft
 * something a human reviews before it touches a real repo." Same
 * draft-then-approve shape as Articles/HN/LinkedIn: generate, show the user,
 * they decide what to do with it.
 */
export class GitHubAgent {
  constructor(private driver: LlmDriver, private apiKey: string, private baseUrl?: string) {}

  async draftFix(req: GitHubRequest): Promise<CompletionResult> {
    const issueList = req.audit.issues.map((i) => `- [${i.level}] ${i.label}`).join("\n");

    if (!issueList) {
      throw new Error("No SEO issues found for this URL — nothing to fix.");
    }

    const system = `You are a senior engineer turning SEO audit findings into a concrete,
reviewable code change proposal for the repository "${req.repo}".
Be specific and technical — this will be read by a developer deciding whether
to actually make the change, not a marketer.`;

    const prompt = `SEO audit found these issues on ${req.audit.url}:
${issueList}

Current meta title: "${req.audit.meta.title || "(missing)"}"
Current meta description: "${req.audit.meta.description || "(missing)"}"
Heading counts: H1=${req.audit.headings.h1}, H2=${req.audit.headings.h2}, H3=${req.audit.headings.h3}

Draft a GitHub pull request proposal in this exact format:

---
title: <concise PR title, e.g. "fix: add missing meta description and OG tags">
---

## Summary
<1-3 sentences on what this PR fixes and why>

## Changes
<bulleted list of concrete file/tag-level changes — e.g. "Add <meta name=\\"description\\"> with a 140-160 char summary">

## Suggested diff
<a small illustrative code snippet showing the fix — HTML/JSX, whichever fits
the issues above. Keep it short and focused, not a full file.>

Do not invent file paths or framework details you weren't given — keep the
diff generic/illustrative if the actual file structure is unknown.`;

    return this.driver({
      apiKey: this.apiKey,
      model: req.model,
      system,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      baseUrl: this.baseUrl,
    });
  }
}
