import { cmsFetch, type CmsFetchOptions } from "./cmsFetch.ts";
import {
  CmsError,
  cmsFieldsFor,
  type CmsApplyResult,
  type CmsCandidate,
  type CmsChange,
  type CmsDraft,
  type CmsField,
  type CmsFixKind,
  type CmsItemRef,
  type CmsPreview,
  type CmsPublisher,
  type CmsUnsupported,
} from "./cmsFixCatalog.ts";

/**
 * Webflow adapter over the Data API v2 (https://api.webflow.com/v2), authenticated with a site API
 * token. Verified against developers.webflow.com: GET /sites, GET /sites/{id}/collections,
 * GET /collections/{id} (fields), GET /collections/{id}/items?slug=, PATCH
 * /collections/{id}/items/{item_id}, POST /collections/{id}/items/publish { itemIds }.
 * NOT verifiable from docs: which of a collection's fields hold SEO copy. Collections name those
 * freely, so fields are matched by common slugs (seo-title, meta-description...) and anything
 * without a matching field is reported as unsupported rather than guessed. Image alt text edits
 * the `alt` of Image / Multi-image field values (shape taken from the docs, untested live).
 */

export const WEBFLOW_API = "https://api.webflow.com/v2";

export type WebflowConfig = { token: string; siteId: string; collectionId: string };

type WfField = { slug: string; displayName?: string; type: string };
type WfItem = { id: string; isDraft?: boolean; isArchived?: boolean; lastPublished?: string | null; fieldData?: Record<string, unknown> };

const TEXT_FIELD_PATTERNS: Partial<Record<CmsField, RegExp>> = {
  title: /^(seo[-_]?title|meta[-_]?title|title[-_]?tag|page[-_]?title)$/,
  meta_description: /^(seo[-_]?(meta[-_]?)?description|meta[-_]?description)$/,
  og_title: /^(og[-_]?title|open[-_]?graph[-_]?title|social[-_]?title)$/,
  og_description: /^(og[-_]?description|open[-_]?graph[-_]?description|social[-_]?description)$/,
};

const NO_FIELD =
  "This collection has no plain-text field for it. Add a field such as 'SEO title' or 'Meta description' to the collection (and bind it in the page's SEO settings), then try again.";

const MAX_ALT_IMAGES = 10;

type Write = { kind: "text"; slug: string } | { kind: "image"; slug: string; index: number | null };
type Plan = { candidates: CmsCandidate[]; unsupported: CmsUnsupported[]; writes: Map<string, Write> };

const stripWww = (host: string) => host.toLowerCase().replace(/^www\./, "");

function slugify(v: unknown): string {
  return typeof v === "string" ? v.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") : "";
}

function textOf(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function imageAlt(v: unknown): { alt: string; url: string } | null {
  const o = v as { alt?: unknown; url?: unknown } | null;
  return o && typeof o === "object" && typeof o.url === "string" ? { alt: textOf(o.alt).trim(), url: o.url } : null;
}

function planFor(fields: WfField[], item: WfItem, wanted: readonly CmsField[]): Plan {
  const data = item.fieldData ?? {};
  const plan: Plan = { candidates: [], unsupported: [], writes: new Map() };
  for (const field of wanted) {
    if (field === "alt_text") {
      let found = 0;
      for (const f of fields) {
        if (f.type !== "Image" && f.type !== "MultiImage") continue;
        const value = data[f.slug];
        const list = f.type === "Image" ? [value] : Array.isArray(value) ? value : [];
        list.forEach((v, index) => {
          const img = imageAlt(v);
          if (!img || img.alt || found >= MAX_ALT_IMAGES) return;
          const target = f.type === "Image" ? f.slug : `${f.slug}:${index}`;
          plan.candidates.push({ field, target, before: "", context: `${f.displayName ?? f.slug}: ${img.url.split("/").pop() ?? img.url}` });
          plan.writes.set(`alt_text:${target}`, { kind: "image", slug: f.slug, index: f.type === "Image" ? null : index });
          found += 1;
        });
      }
      if (found === 0) plan.unsupported.push({ field, reason: "No images without alt text were found on this item." });
      continue;
    }
    const pattern = TEXT_FIELD_PATTERNS[field];
    const match = pattern ? fields.find((f) => f.type === "PlainText" && pattern.test(f.slug.toLowerCase())) : undefined;
    if (match) {
      plan.candidates.push({ field, before: textOf(data[match.slug]), context: match.displayName ?? match.slug });
      plan.writes.set(field, { kind: "text", slug: match.slug });
    } else {
      plan.unsupported.push({ field, reason: NO_FIELD });
    }
  }
  return plan;
}

export class WebflowPublisher implements CmsPublisher {
  readonly cms = "webflow" as const;
  private readonly cfg: WebflowConfig;
  private readonly net: CmsFetchOptions;

  constructor(cfg: WebflowConfig, net: CmsFetchOptions) {
    this.cfg = cfg;
    this.net = net;
  }

  private async call(path: string, init: { method?: string; body?: unknown } = {}) {
    const res = await cmsFetch(
      `${WEBFLOW_API}${path}`,
      {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${this.cfg.token}`,
          Accept: "application/json",
          ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      },
      this.net,
    );
    if (res.status === 401) throw new CmsError("Webflow rejected the saved token. Reconnect it in Settings > Integrations.", 422);
    if (res.status === 403) throw new CmsError("The Webflow token doesn't have permission (it needs CMS read and write).", 422);
    if (res.status === 404) throw new CmsError("Webflow couldn't find that collection or item.", 404);
    if (res.status === 429) throw new CmsError("Webflow is rate limiting requests. Try again in a minute.", 429);
    if (!res.ok) throw new CmsError(`Webflow responded with HTTP ${res.status}.`, 502);
    return res;
  }

  private async collection(): Promise<{ fields?: WfField[]; slug?: string; singularName?: string }> {
    return (await this.call(`/collections/${encodeURIComponent(this.cfg.collectionId)}`)).json() as { fields?: WfField[]; slug?: string; singularName?: string };
  }

  private async fields(): Promise<WfField[]> {
    const col = await this.collection();
    return Array.isArray(col.fields) ? col.fields.filter((f) => typeof f?.slug === "string" && typeof f?.type === "string") : [];
  }

  private async bySlug(slug: string): Promise<WfItem | null> {
    const list = (await this.call(`/collections/${encodeURIComponent(this.cfg.collectionId)}/items?slug=${encodeURIComponent(slug)}&limit=5`)).json() as { items?: WfItem[] };
    return (list.items ?? []).find((i) => textOf(i.fieldData?.slug) === slug && !i.isArchived) ?? null;
  }

  /** Hostnames this site serves: its custom domains plus the default webflow.io one (www is ignored). */
  private async siteHosts(): Promise<Set<string>> {
    const site = (await this.call(`/sites/${encodeURIComponent(this.cfg.siteId)}`)).json() as {
      customDomains?: { url?: string }[];
      shortName?: string;
    };
    const hosts = new Set<string>();
    const add = (raw: unknown) => {
      if (typeof raw !== "string" || !raw.trim()) return;
      try {
        hosts.add(stripWww(new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname));
      } catch {
        // ignore an unparsable domain entry
      }
    };
    for (const d of Array.isArray(site.customDomains) ? site.customDomains : []) add(d?.url);
    if (typeof site.shortName === "string" && site.shortName) add(`${site.shortName}.webflow.io`);
    return hosts;
  }

  /**
   * Maps a page URL to an item of the connected collection. The URL host must be one of THIS
   * site's domains (otherwise a slug could match an unrelated page), and the path must be
   * /<collection slug or singular name>/<item slug>, the shape Webflow gives collection pages.
   * Webflow's API doesn't expose the template page's path, so a different path prefix is refused
   * with a "confirm the page" error instead of guessing from the slug alone.
   */
  async locate(pageUrl: string): Promise<CmsItemRef | null> {
    let page: URL;
    try {
      page = new URL(pageUrl);
    } catch {
      return null;
    }
    const hosts = await this.siteHosts();
    if (!hosts.has(stripWww(page.hostname))) throw new CmsError("This page isn't on your connected Webflow site.", 422);
    const parts = page.pathname.split("/").filter(Boolean);
    const slug = parts[parts.length - 1] ?? "";
    if (!/^[A-Za-z0-9._~-]+$/.test(slug)) return null;
    const col = await this.collection();
    const prefixes = new Set([col.slug, slugify(col.singularName)].filter((v): v is string => Boolean(v)));
    if (parts.length !== 2 || !prefixes.has(parts[0].toLowerCase())) {
      throw new CmsError(
        `Marlo can't confirm that ${page.pathname} is the page for the connected collection (its pages are expected at /${[...prefixes][0] ?? "collection"}/<slug>). Confirm the page in Webflow and fix it by hand, or connect the collection that owns it.`,
        422,
      );
    }
    const item = await this.bySlug(slug);
    if (!item) return null;
    return { cms: "webflow", id: item.id, kind: "items", title: textOf(item.fieldData?.name) || slug, slug, url: pageUrl, collectionId: this.cfg.collectionId };
  }

  private async read(item: CmsItemRef): Promise<WfItem> {
    if (item.collectionId !== this.cfg.collectionId) throw new CmsError("That item isn't in the connected collection.", 400);
    const found = await this.bySlug(item.slug);
    if (!found || found.id !== item.id) throw new CmsError("Webflow couldn't find that item any more. Prepare the fix again.", 404);
    return found;
  }

  async preview(item: CmsItemRef, fix: { kinds: readonly CmsFixKind[]; draft: CmsDraft }): Promise<CmsPreview> {
    const [fields, current] = [await this.fields(), await this.read(item)];
    const plan = planFor(fields, current, cmsFieldsFor("webflow", fix.kinds));
    const changes: CmsChange[] = [];
    for (const c of plan.candidates) {
      const after = c.field === "alt_text" ? fix.draft.alt[c.target ?? ""] : fix.draft.fields[c.field as Exclude<CmsField, "alt_text">];
      if (after && after !== c.before) changes.push({ ...c, after });
    }
    return { item, candidates: plan.candidates, changes, unsupported: plan.unsupported };
  }

  async liveBefore(item: CmsItemRef, changes: readonly CmsChange[]) {
    const [fields, current] = [await this.fields(), await this.read(item)];
    const plan = planFor(fields, current, [...new Set(changes.map((c) => c.field))]);
    return plan.candidates.map((c) => ({ field: c.field, ...(c.target ? { target: c.target } : {}), before: c.before }));
  }

  async apply(item: CmsItemRef, changes: readonly CmsChange[]): Promise<CmsApplyResult> {
    const [fields, current] = [await this.fields(), await this.read(item)];
    const plan = planFor(fields, current, [...new Set(changes.map((c) => c.field))]);
    const data = current.fieldData ?? {};
    const fieldData: Record<string, unknown> = {};
    for (const change of changes) {
      const write = plan.writes.get(change.field === "alt_text" ? `alt_text:${change.target}` : change.field);
      if (!write) throw new CmsError(`This collection can no longer take the ${change.field.replace(/_/g, " ")} change. Prepare the fix again.`, 409);
      if (write.kind === "text") fieldData[write.slug] = change.after;
      else if (write.index === null) fieldData[write.slug] = { ...(data[write.slug] as object), alt: change.after };
      else {
        const list = (fieldData[write.slug] as unknown[] | undefined) ?? [...(data[write.slug] as unknown[])];
        list[write.index] = { ...(list[write.index] as object), alt: change.after };
        fieldData[write.slug] = list;
      }
    }
    const cid = encodeURIComponent(this.cfg.collectionId);
    await this.call(`/collections/${cid}/items/${encodeURIComponent(item.id)}`, { method: "PATCH", body: { fieldData } });
    // Only an item that was already live is published again. A draft stays a draft.
    const wasLive = Boolean(current.lastPublished) && current.isDraft !== true;
    let note: string | undefined;
    if (wasLive) {
      try {
        await this.call(`/collections/${cid}/items/publish`, { method: "POST", body: { itemIds: [item.id] } });
      } catch {
        note = "Saved in Webflow, but publishing the item failed. Publish it from the Webflow Designer.";
      }
    } else {
      note = "Saved to the Webflow item. It wasn't published before, so it stays a draft until you publish it.";
    }
    return { applied: changes.map((c) => c.field), liveUrl: item.url, ...(note ? { note } : {}) };
  }
}

/** Lists sites the token can see (used on connect). Throws CmsError on a bad token. */
export async function listWebflowSites(token: string, net: CmsFetchOptions): Promise<{ id: string; name: string }[]> {
  const res = await cmsFetch(`${WEBFLOW_API}/sites`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, net);
  if (res.status === 401) throw new CmsError("Webflow rejected that token.", 422);
  if (res.status === 403) throw new CmsError("That token can't read sites. Create a site token with 'Sites: read' and 'CMS: read and write'.", 422);
  if (!res.ok) throw new CmsError(`Webflow responded with HTTP ${res.status}.`, 502);
  const data = res.json() as { sites?: { id?: string; displayName?: string; shortName?: string }[] };
  return (data.sites ?? []).filter((s) => typeof s.id === "string").map((s) => ({ id: s.id as string, name: s.displayName ?? s.shortName ?? (s.id as string) }));
}

export async function listWebflowCollections(token: string, siteId: string, net: CmsFetchOptions): Promise<{ id: string; name: string }[]> {
  const res = await cmsFetch(`${WEBFLOW_API}/sites/${encodeURIComponent(siteId)}/collections`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }, net);
  if (res.status === 401 || res.status === 403) throw new CmsError("That token can't read this site's CMS collections.", 422);
  if (res.status === 404) throw new CmsError("Webflow couldn't find that site.", 404);
  if (!res.ok) throw new CmsError(`Webflow responded with HTTP ${res.status}.`, 502);
  const data = res.json() as { collections?: { id?: string; displayName?: string; slug?: string }[] };
  return (data.collections ?? []).filter((c) => typeof c.id === "string").map((c) => ({ id: c.id as string, name: c.displayName ?? c.slug ?? (c.id as string) }));
}
