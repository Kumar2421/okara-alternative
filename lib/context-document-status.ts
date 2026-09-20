import type { ContextDocument } from "./context-data";

/**
 * Maps the document identifiers used by the Context Panel to persisted context rows.
 * Consumers can use this pure helper without issuing duplicate document requests.
 */
export const CONTEXT_DOCUMENT_TYPES = {
  productInfo: "product_info",
  marketingStrategy: "marketing_strategy",
  competitorAnalysis: "competitor_analysis",
  contentStrategy: "content_strategy",
  designGuide: "design_guide",
} as const;

export function getContextDocumentStatus(
  documents: ContextDocument[],
): Record<keyof typeof CONTEXT_DOCUMENT_TYPES, boolean> {
  return {
    productInfo: documents.some((document) => document.doc_type === CONTEXT_DOCUMENT_TYPES.productInfo && Boolean(document.content?.trim())),
    marketingStrategy: documents.some((document) => document.doc_type === CONTEXT_DOCUMENT_TYPES.marketingStrategy && Boolean(document.content?.trim())),
    competitorAnalysis: documents.some((document) => document.doc_type === CONTEXT_DOCUMENT_TYPES.competitorAnalysis && Boolean(document.content?.trim())),
    contentStrategy: documents.some((document) => document.doc_type === CONTEXT_DOCUMENT_TYPES.contentStrategy && Boolean(document.content?.trim())),
    designGuide: documents.some((document) => document.doc_type === CONTEXT_DOCUMENT_TYPES.designGuide && Boolean(document.content?.trim())),
  };
}
