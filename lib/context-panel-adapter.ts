import type { ContextCompetitor, ContextDocument } from "./context-data";
import { getContextDocumentStatus } from "./context-document-status";

/** Adapter consumed by the Context Panel migration to avoid per-document fetches. */
export function selectContextPanelDocumentStatus(documents: ContextDocument[]) {
  return getContextDocumentStatus(documents);
}

/**
 * Returns the stable competitor fields consumed by ContextPanel.
 * Keeping this projection in one place prevents component-local data shaping.
 */
export function selectContextPanelCompetitors(competitors: ContextCompetitor[]) {
  return competitors.map(({ id, url, created_at }) => ({
    id,
    url,
    created_at: created_at ?? "",
  }));
}
