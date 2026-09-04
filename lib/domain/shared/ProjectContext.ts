/** Real project data every content-writing agent grounds its prompts in —
 * injected by the calling route (read from the `projects` + `project_documents`
 * DB tables), never imported as a fixture inside a domain class. Falls back to
 * a generic description only when no project has been created yet, so agents
 * still work (just generically) instead of crashing. */
export type ProjectContext = {
  name: string;
  category: string;
  description: string;
  /** Raw Markdown from the Marketing Strategy document (ICP, positioning,
   * messaging framework), if it's been generated — undefined otherwise.
   * Content-writing agents (Articles, LinkedIn, Reddit, X) should prefer this
   * over inferring positioning themselves when it's present. */
  marketingStrategy?: string;
  /** Raw Markdown from the Competitor Analysis document, if generated. */
  competitorAnalysis?: string;
};

export const NO_PROJECT_CONTEXT: ProjectContext = {
  name: "this product",
  category: "SaaS",
  description: "No project details have been added yet.",
};
