import type { IntegrationResource, IntegrationType } from "./integrationTypes.ts";

type Matchable = Pick<IntegrationResource, "resourceId" | "resourceName">;

/** "https://www.Example.com/path" → "example.com"; undefined for anything unparseable. */
export function hostOf(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

/** Search Console ids look like "sc-domain:example.com" or "https://www.example.com/". */
function searchConsoleHost(resourceId: string): string | undefined {
  if (resourceId.startsWith("sc-domain:")) return resourceId.slice("sc-domain:".length).replace(/^www\./, "").toLowerCase();
  return hostOf(resourceId);
}

/** First label of a host: "example.com" → "example", "shop.example.co.uk" → "shop". */
function brandLabel(host: string): string {
  return host.split(".")[0];
}

/**
 * Which of the account's properties most likely belongs to this project's
 * website. A suggestion only: the user always confirms it.
 *
 * - Search Console: the property whose host equals the project host. A
 *   domain property ("sc-domain:") wins over a URL-prefix one, because it
 *   covers every subdomain and protocol.
 * - GA4: properties carry only a display name, so match when the name
 *   contains the host or the site's brand word (≥ 3 letters, whole word).
 */
export function suggestResourceId(
  projectUrl: string | null | undefined,
  integrationType: IntegrationType,
  resources: Matchable[],
): string | null {
  const host = hostOf(projectUrl);
  if (!host) return null;

  if (integrationType === "google-search-console") {
    const matches = resources.filter((r) => searchConsoleHost(r.resourceId) === host);
    return (matches.find((r) => r.resourceId.startsWith("sc-domain:")) ?? matches[0])?.resourceId ?? null;
  }

  const brand = brandLabel(host);
  const wordPattern = brand.length >= 3 ? new RegExp(`(^|[^a-z0-9])${brand.replace(/[^a-z0-9]/g, "")}([^a-z0-9]|$)`, "i") : null;
  const byHost = resources.find((r) => r.resourceName.toLowerCase().includes(host));
  const byBrand = wordPattern ? resources.find((r) => wordPattern.test(r.resourceName)) : undefined;
  return (byHost ?? byBrand)?.resourceId ?? null;
}
