/** Real bounded reachability check — HEAD first, falls back to GET only if
 * the server doesn't implement HEAD (405/501), since reporting that as
 * unreachable would be a false negative. Shared by the Links tab's
 * reachability check and new-project creation (reject an unreachable URL
 * before it's saved, rather than silently creating a broken project with no
 * way to delete it later). */
export async function checkUrlReachable(url: string, timeoutMs = 8000): Promise<{ reachable: boolean; status?: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: { "User-Agent": "OkaraAlternative/1.0" },
    });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { "User-Agent": "OkaraAlternative/1.0" },
      });
    }
    return { reachable: res.ok, status: res.status };
  } catch {
    return { reachable: false };
  } finally {
    clearTimeout(timeout);
  }
}
