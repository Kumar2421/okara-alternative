/** Real config of the 5 strategy documents Okara's Context panel generates
 * (see refimages). `available: true` means a real generator + route exists.
 * Design Guide / Content Strategy are listed honestly as not-yet-built, not
 * faked as a locked paywall feature. */
export type DocTypeConfig = {
  docType: string;
  name: string;
  available: boolean;
};

export const DOC_TYPES: DocTypeConfig[] = [
  { docType: "product_info", name: "Product Information", available: true },
  { docType: "marketing_strategy", name: "Marketing Strategy", available: true },
  { docType: "competitor_analysis", name: "Competitor Analysis", available: true },
  { docType: "design_guide", name: "Design Guide", available: true },
  { docType: "content_strategy", name: "Content Strategy", available: true },
];
