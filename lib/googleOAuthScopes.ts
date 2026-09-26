/** Production-only: signing in with Google grants GA4 + Search Console
 * read scopes up front, so "Connect Google Services" in the dashboard is
 * just re-triggering the same Google sign-in, not a separate manual OAuth
 * dance requiring the operator's own Google Cloud OAuth client. Self-host
 * mode never requests these — it uses the manual client-id flow in
 * Settings → API Credentials instead (a self-hoster brings their own OAuth
 * client, there's no shared operator identity to reuse).
 *
 * Kept as its own file (not re-exported from app/login/page.tsx) so both a
 * client component (ConnectGoogleServices in AnalyticsPanel.tsx) and the
 * login page can import it without pulling in page-only JSX. */
export const GOOGLE_ANALYTICS_SCOPES =
  "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly";
