"use client";

import DocumentPanel from "./DocumentPanel";

export default function MarketingStrategyPanel({ onClose }: { onClose: () => void }) {
  return (
    <DocumentPanel
      title="Marketing Strategy"
      apiPath="marketing-strategy"
      downloadName="marketing-strategy"
      onClose={onClose}
    />
  );
}
