import type { Finding } from "@/lib/domain/seo/SEOAgent";

export type CodeFixContext = {
  projectId: string;
  projectName: string;
  projectUrl: string;
  /** "owner/repo" */
  repoFullName: string;
  githubToken: string;
};

export type ProposedFix = {
  filePath: string;
  /** Full original/patched file content — what actually gets committed.
   * Not what the UI shows for review (too big); see oldSnippet/newSnippet. */
  before: string;
  after: string;
  /** The small find/replace pair itself — what the review UI actually
   * displays, since showing a whole file diff for a one-tag fix is noise. */
  oldSnippet: string;
  newSnippet: string;
  explanation: string;
  /** Provider-specific state needed to actually push the fix (e.g. the
   * Contents API blob sha) — the route never inspects this, just carries it
   * from proposeFix to applyFix. Keeps the two calls provider-agnostic. */
  applyToken?: string;
};

/**
 * One interface, one real implementation today (ContentsApiFixProvider —
 * read file via Contents API, LLM patches it, push via a new branch + PR).
 * Kept separate from route logic so a future OpenHands-SDK-backed provider
 * (clone + edit + run tests + PR, for fixes bigger than a single-file patch)
 * can implement the same interface and be swapped in via getCodeFixProvider()
 * without touching any calling code.
 */
export interface CodeFixProvider {
  proposeFix(finding: Finding, ctx: CodeFixContext): Promise<ProposedFix>;
  applyFix(fix: ProposedFix, ctx: CodeFixContext, finding: Finding): Promise<{ prUrl: string; branch: string }>;
}
