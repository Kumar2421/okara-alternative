/**
 * The scopes Google actually granted to an access token, or null if it can't
 * be determined. Best-effort: used only to tell the user when Gmail is
 * connected but missing a permission, so a failure here must never block
 * connecting.
 */
export async function fetchGrantedScopes(accessToken: string): Promise<string[] | null> {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { scope?: string };
    const scopes = (data.scope ?? "").split(/\s+/).filter(Boolean);
    return scopes.length > 0 ? scopes : null;
  } catch {
    return null;
  }
}
