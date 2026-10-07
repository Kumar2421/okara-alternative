import {
  CmsError,
  EMPTY_DRAFT,
  sanitizeDraft,
  fieldLimit,
  type CmsCandidate,
  type CmsChange,
  type CmsFixKind,
  type CmsItemRef,
  type CmsPublisher,
  type CmsUnsupported,
} from "./cmsFixCatalog.ts";

/** Pure orchestration (publisher and model are injected): prepare never writes, apply writes only approved changes. */

export type CmsPrepared = { item: CmsItemRef; candidates: CmsCandidate[]; changes: CmsChange[]; unsupported: CmsUnsupported[] };

/** Prompt for the copy model. The reply must be a single JSON object (see parseModelJson). */
export function buildCmsCopyPrompt(args: {
  projectName: string;
  pageUrl: string;
  recommendation: string;
  evidence: Record<string, unknown>;
  candidates: readonly CmsCandidate[];
}): { system: string; prompt: string } {
  const system =
    "You write short SEO copy for one web page. Reply with ONLY one JSON object, no prose, no code fences. " +
    "Use only facts present in the page details given; never invent products, prices, awards or claims. Plain text only: no HTML, no quotes around the whole value.";
  const fieldLines = args.candidates
    .filter((c) => c.field !== "alt_text")
    .map((c) => `- ${c.field} (max ${fieldLimit(c.field)} chars). Current: ${JSON.stringify(c.before.slice(0, 300))}`);
  const altLines = args.candidates.filter((c) => c.field === "alt_text").map((c) => `- ${JSON.stringify(c.target)} (max ${fieldLimit("alt_text")} chars): image ${c.context ?? ""}`);
  const evidence = JSON.stringify(args.evidence).slice(0, 1500);
  const prompt =
    `Site: ${args.projectName}\nPage: ${args.pageUrl}\nIssue to fix: ${args.recommendation}\nEvidence: ${evidence}\n\n` +
    (fieldLines.length ? `Write these fields:\n${fieldLines.join("\n")}\n\n` : "") +
    (altLines.length ? `Write alt text (describe the image for a screen reader) for these images, keyed by the id shown:\n${altLines.join("\n")}\n\n` : "") +
    'Reply as {"fields":{"<field>":"<text>"},"alt":{"<image id>":"<text>"}} and include only the keys listed above.';
  return { system, prompt };
}

export function parseModelJson(text: string | undefined): unknown {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export async function prepareCmsFix(args: {
  publisher: CmsPublisher;
  pageUrl: string | null;
  kinds: readonly CmsFixKind[];
  /** Produces the raw model draft from what the page holds now. */
  draftCopy: (candidates: readonly CmsCandidate[], item: CmsItemRef) => Promise<unknown>;
}): Promise<CmsPrepared> {
  const { publisher, pageUrl } = args;
  if (!pageUrl) throw new CmsError("This finding isn't tied to a page, so Marlo can't find it in your CMS.", 422);
  const item = await publisher.locate(pageUrl);
  if (!item) throw new CmsError("Marlo couldn't find this page in your CMS. It may be a template page, the homepage, or live in another collection.", 422);

  const current = await publisher.preview(item, { kinds: args.kinds, draft: EMPTY_DRAFT });
  if (current.candidates.length === 0) {
    throw new CmsError(current.unsupported[0]?.reason ?? "Nothing on this item can be changed from here.", 422);
  }
  const raw = await args.draftCopy(current.candidates, item);
  const draft = sanitizeDraft(raw, [...new Set(current.candidates.map((c) => c.field))], current.candidates.filter((c) => c.field === "alt_text").map((c) => c.target ?? ""));
  const preview = await publisher.preview(item, { kinds: args.kinds, draft });
  if (preview.changes.length === 0) throw new CmsError("Marlo couldn't draft a usable change for this page. Try again.", 422);
  return { item, candidates: preview.candidates, changes: preview.changes, unsupported: preview.unsupported };
}
