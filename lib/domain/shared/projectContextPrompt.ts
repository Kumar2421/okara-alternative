import type { ProjectContext } from "./ProjectContext";

/** Builds the shared "who is this product, and what's our positioning"
 * prompt block every content-writing agent (Articles, LinkedIn, Reddit, X)
 * prepends to its system prompt. Centralized so all 4 agents read Marketing
 * Strategy / Competitor Analysis the same way instead of each reimplementing
 * slightly differently and drifting apart. */
export function buildProjectContextBlock(project: ProjectContext): string {
  let block = `Product: ${project.name} (${project.category})
What it does: ${project.description}`;

  if (project.marketingStrategy) {
    block += `\n\nUse this Marketing Strategy document as ground truth for positioning, ideal
customer, and messaging — align with it, don't contradict it:
"""
${project.marketingStrategy}
"""`;
  }

  if (project.competitorAnalysis) {
    block += `\n\nCompetitor context (use for differentiation, don't disparage competitors by name):
"""
${project.competitorAnalysis}
"""`;
  }

  return block;
}
