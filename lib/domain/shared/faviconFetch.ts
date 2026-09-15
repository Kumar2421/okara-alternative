/**
 * Fetch website favicon. Returns data: URI or null if unreachable.
 * Tries multiple strategies: favicon.ico, manifest.json, og:image meta tag.
 */
export async function fetchFavicon(urlString: string, timeoutMs: number = 3000): Promise<string | null> {
  try {
    const url = new URL(urlString);
    const baseUrl = url.origin;

    // Strategy 1: favicon.ico
    const icoUrl = `${baseUrl}/favicon.ico`;
    const icoRes = await fetchWithTimeout(icoUrl, timeoutMs);
    if (icoRes?.ok && icoRes.headers.get("content-type")?.includes("image")) {
      const blob = await icoRes.blob();
      return await blobToDataUri(blob);
    }

    // Strategy 2: Fetch HTML and look for og:image or apple-touch-icon
    const htmlRes = await fetchWithTimeout(urlString, timeoutMs);
    if (htmlRes?.ok) {
      const html = await htmlRes.text();

      // Look for og:image
      const ogMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
      if (ogMatch?.[1]) {
        const ogUrl = new URL(ogMatch[1], baseUrl).href;
        const ogRes = await fetchWithTimeout(ogUrl, timeoutMs);
        if (ogRes?.ok && ogRes.headers.get("content-type")?.includes("image")) {
          const blob = await ogRes.blob();
          return await blobToDataUri(blob);
        }
      }

      // Look for apple-touch-icon
      const appleMatch = html.match(/<link\s+rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i);
      if (appleMatch?.[1]) {
        const appleUrl = new URL(appleMatch[1], baseUrl).href;
        const appleRes = await fetchWithTimeout(appleUrl, timeoutMs);
        if (appleRes?.ok && appleRes.headers.get("content-type")?.includes("image")) {
          const blob = await appleRes.blob();
          return await blobToDataUri(blob);
        }
      }

      // Look for any favicon link rel
      const faviconMatch = html.match(/<link\s+rel=["'](?:icon|shortcut icon)["'][^>]*href=["']([^"']+)["']/i);
      if (faviconMatch?.[1]) {
        const favUrl = new URL(faviconMatch[1], baseUrl).href;
        const favRes = await fetchWithTimeout(favUrl, timeoutMs);
        if (favRes?.ok && favRes.headers.get("content-type")?.includes("image")) {
          const blob = await favRes.blob();
          return await blobToDataUri(blob);
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; favicon-fetcher)",
      },
    });
    clearTimeout(timeout);
    return res;
  } catch {
    return null;
  }
}

async function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(reader.result as string);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Cached favicon store — avoid re-fetching same domain.
 */
const FAVICON_CACHE = new Map<string, string | null>();

export async function getCachedFavicon(urlString: string): Promise<string | null> {
  try {
    const hostname = new URL(urlString).hostname;
    if (FAVICON_CACHE.has(hostname)) {
      return FAVICON_CACHE.get(hostname) ?? null;
    }

    const favicon = await fetchFavicon(urlString);
    FAVICON_CACHE.set(hostname, favicon);
    return favicon;
  } catch {
    return null;
  }
}
