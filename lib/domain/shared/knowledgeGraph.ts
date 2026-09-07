/** Real Google Knowledge Graph Search API — verified endpoint/response shape
 * against Google's docs, not assumed. Free, plain API-key auth. Returns null
 * on any failure or no match — callers must never invent a description when
 * this comes back empty. */
export async function lookupEntityDescription(apiKey: string, name: string): Promise<string | null> {
  if (!apiKey || !name.trim()) return null;

  const url = new URL("https://kgsearch.googleapis.com/v1/entities:search");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("query", name);
  url.searchParams.set("limit", "1");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.itemListElement?.[0]?.result;
    const description: string | undefined = result?.detailedDescription?.articleBody || result?.description;
    return description?.trim() || null;
  } catch {
    return null;
  }
}
