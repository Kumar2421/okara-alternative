/** Production-only Google service scopes granted by the single Google sign-in.
 * Platform users do not configure Google OAuth credentials themselves. The
 * operator owns the OAuth client in Supabase/Google Cloud; users authorize
 * the services once through the normal Google login flow.
 *
 * Self-host mode never requests these extra scopes. Self-hosters bring their
 * own OAuth credentials and use the dedicated manual integration flows.
 */
export const GOOGLE_ANALYTICS_SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");
