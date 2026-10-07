import * as cheerio from "cheerio";
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
 * WordPress adapter over the core REST API (/wp-json/wp/v2), authenticated with an Application
 * Password (the connection WordPressCard stores). The page is looked up by slug; the post title is
 * core; SEO fields are written only through Yoast SEO / Rank Math meta keys WHEN the site exposes
 * them to REST, otherwise the field is reported as unsupported (never guessed, never half-written).
 * Unverified against live Yoast/Rank Math installs: many sites don't register their meta for REST.
 */

type SeoField = Exclude<CmsField, "h1" | "alt_text">;

const SEO_META_KEYS: Record<"yoast" | "rankmath", Record<SeoField, string>> = {
  yoast: {
    title: "_yoast_wpseo_title",
    meta_description: "_yoast_wpseo_metadesc",
    og_title: "_yoast_wpseo_opengraph-title",
    og_description: "_yoast_wpseo_opengraph-description",
    twitter_title: "_yoast_wpseo_twitter-title",
    twitter_description: "_yoast_wpseo_twitter-description",
    canonical: "_yoast_wpseo_canonical",
  },
  rankmath: {
    title: "rank_math_title",
    meta_description: "rank_math_description",
    og_title: "rank_math_facebook_title",
    og_description: "rank_math_facebook_description",
    twitter_title: "rank_math_twitter_title",
    twitter_description: "rank_math_twitter_description",
    canonical: "rank_math_canonical_url",
  },
};

const MAX_ALT_IMAGES = 10;

export type WordPressConfig = {
  /** Site origin, e.g. https://example.com */
  baseUrl: string;
  /** "username:application password" (the shape Basic auth needs). Never logged. */
  credentials: string;
};

type WpRecord = {
  id?: number;
  link?: string;
  slug?: string;
  title?: { raw?: string; rendered?: string };
  content?: { raw?: string };
  meta?: unknown;
};

const stripWww = (host: string) => host.toLowerCase().replace(/^www\./, "");

function pathOf(url: string): string {
  return new URL(url).pathname.replace(/\/+$/, "") || "/";
}

function metaObject(rec: WpRecord): Record<string, unknown> {
  return rec.meta && typeof rec.meta === "object" && !Array.isArray(rec.meta) ? (rec.meta as Record<string, unknown>) : {};
}

function metaKeyFor(meta: Record<string, unknown>, field: SeoField): string | null {
  for (const plugin of ["yoast", "rankmath"] as const) {
    const key = SEO_META_KEYS[plugin][field];
    if (key in meta) return key;
  }
  return null;
}

const NEEDS_PLUGIN =
  "Your site doesn't expose this SEO field to the REST API. It needs Yoast SEO or Rank Math with their meta exposed to REST. Set it in the SEO plugin by hand.";

type ImageTarget = { id: string; src: string };

/** Images in the post content that carry a WordPress media id and have no alt text. */
function imagesMissingAlt(contentRaw: string): ImageTarget[] {
  const $ = cheerio.load(contentRaw);
  const out: ImageTarget[] = [];
  $("img").each((_, el) => {
    const alt = ($(el).attr("alt") ?? "").trim();
    const m = ($(el).attr("class") ?? "").match(/\bwp-image-(\d+)\b/);
    if (!alt && m && !out.some((i) => i.id === m[1])) out.push({ id: m[1], src: $(el).attr("src") ?? "" });
  });
  return out.slice(0, MAX_ALT_IMAGES);
}

function fileName(src: string): string {
  try {
    return new URL(src, "https://x.invalid").pathname.split("/").pop() ?? "";
  } catch {
    return "";
  }
}

type Plan = { candidates: CmsCandidate[]; unsupported: CmsUnsupported[]; writes: Map<string, { kind: "meta"; key: string } | { kind: "title" } | { kind: "media"; id: string }> };

function planFor(rec: WpRecord, fields: readonly CmsField[]): Plan {
  const meta = metaObject(rec);
  const postTitle = rec.title?.raw ?? "";
  const plan: Plan = { candidates: [], unsupported: [], writes: new Map() };
  let titleWriteTaken = false;
  const order: CmsField[] = [...fields].sort((a, b) => (a === "title" ? -1 : b === "title" ? 1 : 0));
  for (const field of order) {
    if (field === "alt_text") {
      const imgs = imagesMissingAlt(rec.content?.raw ?? "");
      if (imgs.length === 0) plan.unsupported.push({ field, reason: "No images without alt text were found in this post's content." });
      for (const img of imgs) {
        plan.candidates.push({ field, target: img.id, before: "", context: fileName(img.src) || img.src });
        plan.writes.set(`alt_text:${img.id}`, { kind: "media", id: img.id });
      }
      continue;
    }
    if (field === "h1") {
      // The theme renders the post title as the page's H1.
      if (titleWriteTaken) {
        plan.unsupported.push({ field, reason: "The post title is already being changed as the page title, which is also the H1." });
        continue;
      }
      titleWriteTaken = true;
      plan.candidates.push({ field, before: postTitle, context: "Post title (shown as the H1)" });
      plan.writes.set("h1", { kind: "title" });
      continue;
    }
    const key = metaKeyFor(meta, field);
    if (key) {
      plan.candidates.push({ field, before: typeof meta[key] === "string" ? (meta[key] as string) : "" });
      plan.writes.set(field, { kind: "meta", key });
    } else if (field === "title" && !titleWriteTaken) {
      titleWriteTaken = true;
      plan.candidates.push({ field, before: postTitle, context: "Post title (no SEO plugin field available)" });
      plan.writes.set("title", { kind: "title" });
    } else {
      plan.unsupported.push({ field, reason: NEEDS_PLUGIN });
    }
  }
  return plan;
}

export class WordPressPublisher implements CmsPublisher {
  readonly cms = "wordpress" as const;
  private readonly cfg: WordPressConfig;
  private readonly net: CmsFetchOptions;

  constructor(cfg: WordPressConfig, net: CmsFetchOptions) {
    this.cfg = { ...cfg, baseUrl: cfg.baseUrl.replace(/\/+$/, "") };
    this.net = net;
  }

  private headers(json = false): Record<string, string> {
    return {
      Authorization: `Basic ${Buffer.from(this.cfg.credentials).toString("base64")}`,
      Accept: "application/json",
      "User-Agent": "MarloBot/1.0",
      ...(json ? { "Content-Type": "application/json" } : {}),
    };
  }

  private async call(path: string, init: { method?: string; body?: unknown } = {}) {
    const res = await cmsFetch(
      `${this.cfg.baseUrl}/wp-json/wp/v2/${path}`,
      { method: init.method ?? "GET", headers: this.headers(init.body !== undefined), ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) },
      this.net,
    );
    if (res.status === 401) throw new CmsError("WordPress rejected the saved credentials. Reconnect it in Settings > Integrations.", 422);
    if (res.status === 403) throw new CmsError("The connected WordPress user isn't allowed to edit this content.", 422);
    if (res.status === 404) throw new CmsError("WordPress couldn't find that item. It may have been deleted.", 404);
    if (!res.ok) throw new CmsError(`WordPress responded with HTTP ${res.status}.`, 502);
    return res;
  }

  async locate(pageUrl: string): Promise<CmsItemRef | null> {
    let page: URL;
    try {
      page = new URL(pageUrl);
    } catch {
      return null;
    }
    if (stripWww(page.hostname) !== stripWww(new URL(this.cfg.baseUrl).hostname)) {
      throw new CmsError("This page isn't on your connected WordPress site.", 422);
    }
    const pathname = pathOf(pageUrl);
    if (pathname === "/") return null; // the homepage is a template/settings, not a post slug
    const slug = pathname.split("/").filter(Boolean).pop() ?? "";
    if (!/^[A-Za-z0-9._~%-]+$/.test(slug)) return null;
    for (const kind of ["pages", "posts"] as const) {
      const res = await this.call(`${kind}?slug=${encodeURIComponent(slug)}&context=edit&per_page=5&_fields=id,link,slug,title`);
      const list = res.json();
      if (!Array.isArray(list)) continue;
      const hit = (list as WpRecord[]).find((r) => typeof r.link === "string" && pathOf(r.link) === pathname);
      if (hit && typeof hit.id === "number") {
        return { cms: "wordpress", id: String(hit.id), kind, title: hit.title?.raw ?? hit.title?.rendered ?? slug, slug, url: hit.link as string };
      }
    }
    return null;
  }

  private async read(item: CmsItemRef): Promise<WpRecord> {
    if (!/^\d+$/.test(item.id) || (item.kind !== "posts" && item.kind !== "pages")) throw new CmsError("That item isn't valid.", 400);
    const rec = (await this.call(`${item.kind}/${item.id}?context=edit&_fields=id,link,slug,title,content,meta`)).json() as WpRecord;
    if (!rec || typeof rec !== "object") throw new CmsError("WordPress returned an unexpected response.", 502);
    return rec;
  }

  async preview(item: CmsItemRef, fix: { kinds: readonly CmsFixKind[]; draft: CmsDraft }): Promise<CmsPreview> {
    const rec = await this.read(item);
    const plan = planFor(rec, cmsFieldsFor("wordpress", fix.kinds));
    const changes: CmsChange[] = [];
    for (const c of plan.candidates) {
      const after = c.field === "alt_text" ? fix.draft.alt[c.target ?? ""] : fix.draft.fields[c.field as Exclude<CmsField, "alt_text">];
      if (after && after !== c.before) changes.push({ ...c, after });
    }
    return { item, candidates: plan.candidates, changes, unsupported: plan.unsupported };
  }

  async apply(item: CmsItemRef, changes: readonly CmsChange[]): Promise<CmsApplyResult> {
    const rec = await this.read(item);
    const plan = planFor(rec, [...new Set(changes.map((c) => c.field))]);
    const body: { title?: string; meta?: Record<string, string> } = {};
    const media: { id: string; alt: string }[] = [];
    for (const change of changes) {
      const write = plan.writes.get(change.field === "alt_text" ? `alt_text:${change.target}` : change.field);
      if (!write) throw new CmsError(`This site can no longer take the ${change.field.replace(/_/g, " ")} change. Prepare the fix again.`, 409);
      if (write.kind === "title") body.title = change.after;
      else if (write.kind === "meta") body.meta = { ...(body.meta ?? {}), [write.key]: change.after };
      else media.push({ id: write.id, alt: change.after });
    }
    // Nothing is written above this line: every change was checked against the live item first.
    if (body.title !== undefined || body.meta) await this.call(`${item.kind}/${item.id}`, { method: "POST", body });
    for (const m of media) await this.call(`media/${m.id}`, { method: "POST", body: { alt_text: m.alt } });
    return { applied: changes.map((c) => c.field), liveUrl: item.url };
  }
}
