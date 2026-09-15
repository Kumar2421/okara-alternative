/**
 * GET /api/settings feeds every Settings card + several other components
 * that just check "is X present" — that route used to return the raw
 * `settings` table straight to the browser, including OAuth access/refresh
 * tokens, API keys, and the GitHub PAT. Anyone with devtools open (or any
 * XSS, or a malicious browser extension) could read every connected
 * credential in plaintext from that one response.
 *
 * These keys never leave the server as their real value again — the GET
 * route replaces them with a masked preview (first 4 / last 2 chars, same
 * shape the cards were already displaying) computed here, server-side. A
 * card that only needs "is it connected" still gets a truthy, non-empty
 * string; a card that used to slice the raw value itself now just renders
 * what the server already masked.
 */
const SECRET_SETTING_KEYS = new Set([
  "tavily_api_key",
  "pagespeed_api_key",
  "google_cloud_api_key",
  "gmail_access_token",
  "gmail_refresh_token",
  "ga_access_token",
  "ga_refresh_token",
  "gcp_access_token",
  "gcp_refresh_token",
  "github_pat",
  "reddit_api_key",
  "x_api_key",
]);

export function maskSecretValue(value: string): string {
  if (value.length <= 6) return "••••••";
  return `${value.slice(0, 4)}••••${value.slice(-2)}`;
}

export function redactSettingsForClient(rows: { key: string; value: string }[]): { key: string; value: string }[] {
  return rows.map((row) => (SECRET_SETTING_KEYS.has(row.key) && row.value ? { key: row.key, value: maskSecretValue(row.value) } : row));
}
