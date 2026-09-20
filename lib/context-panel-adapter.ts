import type { ContextDocument } from "./context-data";
import { getContextDocumentStatus } from "./context-document-status";

/** Adapter consumed by the Context Panel migration to avoid per-document fetches. */
export function selectContextPanelDocumentStatus(documents: ContextDocument[]) {
  return getContextDocumentStatus(documents);
}
