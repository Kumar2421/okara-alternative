import type { TavilyResult } from "@/lib/domain/shared/webSearchTool";

/** Real Google Custom Search JSON API — verified endpoint/params against
 * Google's own docs, not assumed. Needs BOTH an API key and a Programmable
 * Search Engine ID (cx) — the cx is a separate real setup step, not just an
 * API key, so this silently returns [] rather than throwing if either is
 * missing (callers already have Tavily as the primary source). */
export async function googleSearchRaw(apiKey: string, cx: string, query: string, num = 10): Promise<TavilyResult[]> {
  if (!apiKey || !cx) return [];

  const url = new URL("https://customsearch.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(num, 10))); // API's real per-request cap

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items ?? []).map((item: { title?: string; link?: string; snippet?: string }) => ({
      title: item.title ?? "",
      url: item.link ?? "",
      content: item.snippet ?? "",
    }));
  } catch {
    return [];
  }
}
