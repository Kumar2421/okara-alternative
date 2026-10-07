import { CmsError } from "./cmsFixCatalog.ts";

/**
 * Fetch for talking to a user-supplied CMS origin. SSRF-safe: the URL guard runs on the first URL
 * and on every redirect hop, redirects are capped, a redirect may never leave the original host
 * (so credentials are never sent elsewhere), and bodies are read with a byte cap.
 */

export const CMS_MAX_REDIRECTS = 3;
export const CMS_MAX_BODY_BYTES = 2_000_000;

export type CmsFetchOptions = {
  /** Throws when the URL must not be fetched (use assertPublicHttpUrl). */
  assertUrl: (url: string) => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** The DNS names for private ranges the shared guard may not cover (IPv6 loopback and friends). */
export function assertPublicCmsUrl(raw: string, base: (url: string) => unknown): URL {
  base(raw);
  const u = new URL(raw);
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isV6 = host.includes(":");
  if (host === "::1" || host === "::" || (isV6 && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80") || host.startsWith("::ffff:")))) {
    throw new Error("URLs pointing to local/private addresses are not allowed");
  }
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) || /^0\./.test(host)) throw new Error("URLs pointing to local/private addresses are not allowed");
  return u;
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, maxBytes);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  try {
    await reader.cancel();
  } catch {
    // already closed
  }
  const all = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const c of chunks) {
    const piece = c.subarray(0, Math.max(0, all.length - offset));
    all.set(piece, offset);
    offset += piece.length;
  }
  return new TextDecoder("utf-8").decode(all);
}

export type CmsResponse = { status: number; ok: boolean; text: string; json: () => unknown };

export async function cmsFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string }, opts: CmsFetchOptions): Promise<CmsResponse> {
  const doFetch = opts.fetchImpl ?? fetch;
  let current = url;
  const originalHost = new URL(url).hostname.toLowerCase();
  for (let hop = 0; hop <= CMS_MAX_REDIRECTS; hop += 1) {
    try {
      opts.assertUrl(current);
    } catch (err) {
      throw new CmsError(err instanceof Error ? err.message : "That address can't be used.", 400);
    }
    let res: Response;
    try {
      res = await doFetch(current, { ...init, redirect: "manual", signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000) });
    } catch (err) {
      throw new CmsError(`Couldn't reach the site (${err instanceof Error ? err.message : "network error"}).`, 502);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      try {
        await res.body?.cancel();
      } catch {
        // ignore
      }
      if (!location) throw new CmsError(`The site redirected without a destination (HTTP ${res.status}).`, 502);
      const next = new URL(location, current);
      if (next.hostname.toLowerCase() !== originalHost) throw new CmsError("The site redirected to a different host, so Marlo stopped.", 502);
      // A 301/302 on a write would silently turn into a GET; refuse rather than guess.
      if (init.method && init.method !== "GET" && res.status !== 307 && res.status !== 308) throw new CmsError("The site redirected a write request. Reconnect with the site's final address.", 502);
      current = next.toString();
      continue;
    }
    const text = await readCapped(res, CMS_MAX_BODY_BYTES);
    return {
      status: res.status,
      ok: res.ok,
      text,
      json: () => {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new CmsError("The site returned something that isn't JSON.", 502);
        }
      },
    };
  }
  throw new CmsError("The site redirected too many times.", 502);
}
