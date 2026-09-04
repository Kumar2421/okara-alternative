import { tavilySearchRaw } from "@/lib/domain/shared/webSearchTool";

export type GeoCitationRow = { query: string; found: boolean; matchedUrl?: string };

/**
 * Real "citation gap" check — the Agents Feed reference screenshot literally
 * calls GEO agent output "citation gaps," which is exactly what this is: for
 * each real query, does the project's own domain show up anywhere in the
 * live search results? No LLM involved — deterministic, so a "gap" is a real
 * absence from real results, not a model's guess about visibility.
 */
export async function checkCitations(
  tavilyApiKey: string,
  projectName: string,
  category: string,
  domain: string
): Promise<GeoCitationRow[]> {
  const queries = [
    projectName,
    `${projectName} alternative`,
    category ? `best ${category} tools` : `${projectName} review`,
  ];

  const rows: GeoCitationRow[] = [];
  for (const query of queries) {
    try {
      const results = await tavilySearchRaw(tavilyApiKey, query, 8);
      const match = results.find((r) => {
        try {
          return new URL(r.url).hostname.replace(/^www\./, "").toLowerCase() === domain;
        } catch {
          return false;
        }
      });
      rows.push({ query, found: !!match, matchedUrl: match?.url });
    } catch {
      rows.push({ query, found: false });
    }
  }
  return rows;
}
