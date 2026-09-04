import { getDb } from "@/lib/db";
import { NO_PROJECT_CONTEXT, type ProjectContext } from "./ProjectContext";
import { getActiveProjectId } from "./getActiveProjectId";

/** Reads whichever project is currently active (see getActiveProjectId.ts),
 * plus any generated Marketing Strategy / Competitor Analysis documents, for
 * server-side agent routes to ground prompts in. Falls back to
 * NO_PROJECT_CONTEXT rather than throwing — an agent should still run (just
 * generically) before a project has been created. */
export function getActiveProjectContext(): ProjectContext {
  const activeId = getActiveProjectId();
  if (!activeId) return NO_PROJECT_CONTEXT;

  const db = getDb();
  const row = db.prepare("SELECT name, category, description FROM projects WHERE id = ?").get(activeId) as
    | { name: string; category: string; description: string }
    | undefined;

  if (!row) return NO_PROJECT_CONTEXT;

  const docs = db
    .prepare("SELECT doc_type, content FROM project_documents WHERE project_id = ? AND doc_type IN ('marketing_strategy', 'competitor_analysis')")
    .all(activeId) as { doc_type: string; content: string }[];

  const marketingStrategy = docs.find((d) => d.doc_type === "marketing_strategy")?.content || undefined;
  const competitorAnalysis = docs.find((d) => d.doc_type === "competitor_analysis")?.content || undefined;

  return { name: row.name, category: row.category, description: row.description, marketingStrategy, competitorAnalysis };
}
