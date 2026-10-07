/**
 * CSRF guard for cookie- or no-auth POST routes: the browser's Origin header
 * must name the host the request was sent to. Falls back to Sec-Fetch-Site
 * when Origin is absent; with neither header the request is refused.
 */
export function isSameOriginRequest(headers: { get(name: string): string | null }): boolean {
  const origin = headers.get("origin");
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  if (origin) {
    try {
      return host !== "" && new URL(origin).host.toLowerCase() === host;
    } catch {
      return false;
    }
  }
  return headers.get("sec-fetch-site") === "same-origin";
}
