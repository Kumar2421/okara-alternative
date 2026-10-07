import { CmsError } from "./cmsFixCatalog.ts";
import { BLOCKED_MESSAGE, assertPublicHostLiteral } from "../net/ssrf.ts";

/**
 * Fetch for talking to a user-supplied CMS origin. SSRF-safe: the URL guard runs on the first URL
 * and on every redirect hop, redirects are capped, a redirect may never leave the original origin
 * (protocol + host + port; the only exception is a same-host http -> https upgrade on default ports),
 * Authorization is never sent on a cross-origin hop (the hop is refused), an https -> http downgrade is refused, and
 * bodies are read with a byte cap. Error text is generic (no network error details are echoed).
 */

export const CMS_MAX_REDIRECTS = 3;
export const CMS_MAX_BODY_BYTES = 2_000_000;

export type CmsFetchOptions = {
  /** Throws when the URL must not be fetched (use assertPublicHttpUrl). */
  assertUrl: (url: string) => void;
  /**
   * Resolves the host and throws when any address is non-public. Runs immediately before every
   * connection (each hop). A small DNS-rebinding window remains between this lookup and the
   * connect fetch() performs itself: closing it fully needs a pinned-IP agent.
   */
  resolve?: (host: string) => Promise<void>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** Base guard plus the shared name and IP-literal checks (trailing dot, *.internal, IPv6, CGNAT...). */
export function assertPublicCmsUrl(raw: string, base: (url: string) => unknown): URL {
  base(raw);
  const u = new URL(raw);
  assertPublicHostLiteral(u.hostname);
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
  for (let hop = 0; hop <= CMS_MAX_REDIRECTS; hop += 1) {
    try {
      opts.assertUrl(current);
    } catch {
      throw new CmsError(BLOCKED_MESSAGE, 400);
    }
    try {
      await opts.resolve?.(new URL(current).hostname);
    } catch {
      throw new CmsError(BLOCKED_MESSAGE, 400);
    }
    let res: Response;
    try {
      res = await doFetch(current, { ...init, redirect: "manual", signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000) });
    } catch {
      throw new CmsError("Couldn't reach the site.", 502);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      try {
        await res.body?.cancel();
      } catch {
        // ignore
      }
      if (!location) throw new CmsError(`The site redirected without a destination (HTTP ${res.status}).`, 502);
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new CmsError("The site redirected to an invalid address.", 502);
      }
      const from = new URL(current);
      const DIFFERENT = "The site redirected to a different host, so Marlo stopped.";
      if (next.hostname.toLowerCase() !== from.hostname.toLowerCase()) throw new CmsError(DIFFERENT, 502);
      if (from.protocol === "https:" && next.protocol === "http:") throw new CmsError("The site redirected from https to http, so Marlo stopped.", 502);
      const sameOrigin = next.origin === from.origin;
      const upgrade = from.protocol === "http:" && next.protocol === "https:" && next.hostname.toLowerCase() === from.hostname.toLowerCase() && !from.port && !next.port;
      // A cross-origin hop is refused outright, so Authorization is never sent to another origin.
      if (!sameOrigin && !upgrade) throw new CmsError(DIFFERENT, 502);
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
