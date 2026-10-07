import { classifyFinding, type FindingLike, type FixKind } from "../codefix/fixCatalog.ts";

/**
 * Which SEO fixes a connected CMS can apply directly (no GitHub), plus the port a CMS adapter
 * implements. Pure: nothing here touches the network. Structural changes (rewrites, layout,
 * speed) are never CMS-applicable: they stay manual.
 */

export const CMS_IDS = ["wordpress", "webflow"] as const;
export type CmsId = (typeof CMS_IDS)[number];

export const CMS_LABEL: Record<CmsId, string> = { wordpress: "WordPress", webflow: "Webflow" };

export function isCmsId(value: unknown): value is CmsId {
  return typeof value === "string" && (CMS_IDS as readonly string[]).includes(value);
}

/** The concrete field a change writes. */
export const CMS_FIELDS = [
  "title",
  "meta_description",
  "og_title",
  "og_description",
  "twitter_title",
  "twitter_description",
  "h1",
  "canonical",
  "alt_text",
] as const;
export type CmsField = (typeof CMS_FIELDS)[number];

/** Fix kinds a CMS may apply: the catalog's kinds plus "h1" (WordPress only). */
export type CmsFixKind = FixKind | "h1";

const WORDPRESS_KINDS: readonly CmsFixKind[] = ["title", "meta_description", "open_graph", "twitter_card", "alt_text", "h1", "canonical"];
const WEBFLOW_KINDS: readonly CmsFixKind[] = ["title", "meta_description", "open_graph", "alt_text"];

export const CMS_FIX_KINDS: Record<CmsId, readonly CmsFixKind[]> = { wordpress: WORDPRESS_KINDS, webflow: WEBFLOW_KINDS };

/** Fields each fix kind writes. */
export const KIND_FIELDS: Record<CmsFixKind, readonly CmsField[]> = {
  title: ["title"],
  meta_description: ["meta_description"],
  open_graph: ["og_title", "og_description"],
  twitter_card: ["twitter_title", "twitter_description"],
  alt_text: ["alt_text"],
  h1: ["h1"],
  canonical: ["canonical"],
  // Not CMS-applicable (code or new files only); listed so the table is total.
  json_ld: [],
  faq_schema: [],
  llms_txt: [],
  sitemap: [],
};

export function cmsCanApply(cms: CmsId, kind: CmsFixKind): boolean {
  return CMS_FIX_KINDS[cms].includes(kind);
}

export function cmsFieldsFor(cms: CmsId, kinds: readonly CmsFixKind[]): CmsField[] {
  return [...new Set(kinds.filter((k) => cmsCanApply(cms, k)).flatMap((k) => KIND_FIELDS[k]))];
}

export type CmsVerdict =
  | { fixable: true; kinds: CmsFixKind[]; label: string }
  | { fixable: false; reason: string };

const KIND_LABEL: Record<string, string> = {
  title: "Page title",
  meta_description: "Meta description",
  open_graph: "Open Graph tags",
  twitter_card: "Twitter card tags",
  alt_text: "Image alt text",
  h1: "Main heading (H1)",
  canonical: "Canonical link",
};

/**
 * Can this CMS apply the fix for this finding? Only when EVERY kind the finding needs is
 * supported: a partly-supported fix is not offered, so nothing half-applies.
 */
export function classifyForCms(cms: CmsId, finding: FindingLike): CmsVerdict {
  const verdict = classifyFinding(finding);
  if (verdict.mode === "manual") return { fixable: false, reason: verdict.reason };
  const unsupported = verdict.kinds.filter((k) => !cmsCanApply(cms, k));
  if (unsupported.length > 0) {
    return {
      fixable: false,
      reason: `${CMS_LABEL[cms]} can't apply ${unsupported.map((k) => KIND_LABEL[k] ?? k).join(", ")} directly. Use GitHub or make this change by hand.`,
    };
  }
  return { fixable: true, kinds: verdict.kinds, label: verdict.kinds.map((k) => KIND_LABEL[k] ?? k).join(" + ") };
}

/** The first connected CMS that can apply the finding, or null. */
export function anyCmsCanFix(connected: readonly CmsId[], finding: FindingLike): CmsId | null {
  return connected.find((cms) => classifyForCms(cms, finding).fixable) ?? null;
}

// ---------- port ----------

/** The post, page or CMS item a public URL maps to. Carried in the signed ticket. */
export type CmsItemRef = {
  cms: CmsId;
  id: string;
  /** WordPress: "posts" | "pages"; Webflow: "items". */
  kind: string;
  title: string;
  slug: string;
  url: string;
  /** Webflow collection id. */
  collectionId?: string;
};

/** One field edit. `target` identifies the image for alt text. */
export type CmsChange = {
  field: CmsField;
  target?: string;
  before: string;
  after: string;
  /** Shown to the user and the model (e.g. the image file name); never written. */
  context?: string;
};

/** A field the CMS could change, with what it holds now (before drafting). */
export type CmsCandidate = Omit<CmsChange, "after">;

export type CmsUnsupported = { field: CmsField; reason: string };

export type CmsDraft = {
  fields: Partial<Record<Exclude<CmsField, "alt_text">, string>>;
  /** Alt text by image target id. */
  alt: Record<string, string>;
};

export type CmsPreview = {
  item: CmsItemRef;
  /** Every supported field for the requested kinds, with current values (the model reads these). */
  candidates: CmsCandidate[];
  /** The proposed edits: candidates the draft gives a new, different value. */
  changes: CmsChange[];
  unsupported: CmsUnsupported[];
};

export type CmsApplyResult = { applied: CmsField[]; liveUrl: string; note?: string };

/** An error whose message is safe to show the user. */
export class CmsError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = "CmsError";
    this.status = status;
  }
}

export interface CmsPublisher {
  readonly cms: CmsId;
  /** Maps a public page URL to its item, or null when it is not an item this CMS manages. */
  locate(pageUrl: string): Promise<CmsItemRef | null>;
  /** Read-only: current values and the before/after for `draft`. Never writes. */
  preview(item: CmsItemRef, fix: { kinds: readonly CmsFixKind[]; draft: CmsDraft }): Promise<CmsPreview>;
  /** Writes exactly `changes` (already validated and approved). */
  apply(item: CmsItemRef, changes: readonly CmsChange[]): Promise<CmsApplyResult>;
}

export const EMPTY_DRAFT: CmsDraft = { fields: {}, alt: {} };

// ---------- validation ----------

const MAX_LEN: Record<CmsField, number> = {
  title: 70,
  meta_description: 320,
  og_title: 100,
  og_description: 300,
  twitter_title: 100,
  twitter_description: 300,
  h1: 120,
  canonical: 300,
  alt_text: 150,
};
export const MAX_CMS_CHANGES = 12;

/** Plain text only: no markup or control characters, collapsed whitespace. */
export function cleanCopy(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}

function sameSite(a: string, b: string): boolean {
  try {
    const norm = (u: string) => new URL(u).hostname.replace(/^www\./, "").toLowerCase();
    return norm(a) === norm(b);
  } catch {
    return false;
  }
}

/** Checks the changes a client sent back. Throws CmsError(400) naming the problem. */
export function parseClientCmsChanges(raw: unknown, ctx: { cms: CmsId; pageUrl: string | null }): CmsChange[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new CmsError("There is nothing to apply.", 400);
  if (raw.length > MAX_CMS_CHANGES) throw new CmsError("Too many changes in one fix.", 400);
  const seen = new Set<string>();
  const out: CmsChange[] = [];
  for (const entry of raw) {
    const e = entry as Partial<CmsChange> | null;
    if (!e || typeof e !== "object" || !(CMS_FIELDS as readonly string[]).includes(e.field as string)) throw new CmsError("A change has an unknown field.", 400);
    const field = e.field as CmsField;
    if (!CMS_FIX_KINDS[ctx.cms].some((k) => KIND_FIELDS[k].includes(field))) throw new CmsError(`${CMS_LABEL[ctx.cms]} can't change this field.`, 400);
    const target = typeof e.target === "string" && e.target.length > 0 && e.target.length <= 100 ? e.target : undefined;
    if (field === "alt_text" && !target) throw new CmsError("An alt text change needs an image.", 400);
    if (field !== "alt_text" && target) throw new CmsError("Only alt text targets an image.", 400);
    const key = `${field}:${target ?? ""}`;
    if (seen.has(key)) throw new CmsError("The same field appears twice.", 400);
    seen.add(key);
    const after = cleanCopy(e.after);
    if (!after) throw new CmsError("A new value can't be empty.", 400);
    if (after.length > MAX_LEN[field]) throw new CmsError(`The new ${field.replace(/_/g, " ")} is too long (max ${MAX_LEN[field]} characters).`, 400);
    if (field === "canonical") {
      let ok = false;
      try {
        const u = new URL(after);
        ok = (u.protocol === "https:" || u.protocol === "http:") && (!ctx.pageUrl || sameSite(after, ctx.pageUrl));
      } catch {
        ok = false;
      }
      if (!ok) throw new CmsError("The canonical link must be a full URL on your own site.", 400);
    }
    const before = typeof e.before === "string" ? e.before.slice(0, 2000) : "";
    const context = typeof e.context === "string" ? e.context.slice(0, 200) : undefined;
    out.push({ field, ...(target ? { target } : {}), before, after, ...(context ? { context } : {}) });
  }
  return out;
}

/** Turns a model draft into the sanitized shape; unknown keys are dropped. */
export function sanitizeDraft(raw: unknown, allowedFields: readonly CmsField[], allowedAltTargets: readonly string[]): CmsDraft {
  const r = (raw ?? {}) as { fields?: Record<string, unknown>; alt?: Record<string, unknown> };
  const draft: CmsDraft = { fields: {}, alt: {} };
  for (const field of allowedFields) {
    if (field === "alt_text") continue;
    const v = cleanCopy(r.fields?.[field]);
    if (v && v.length <= MAX_LEN[field]) draft.fields[field] = v;
  }
  if (allowedFields.includes("alt_text")) {
    for (const t of allowedAltTargets) {
      const v = cleanCopy(r.alt?.[t]);
      if (v && v.length <= MAX_LEN.alt_text) draft.alt[t] = v;
    }
  }
  return draft;
}

export function fieldLimit(field: CmsField): number {
  return MAX_LEN[field];
}
