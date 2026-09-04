"use client";

import DocumentPanel from "./DocumentPanel";

export default function CompetitorAnalysisPanel({ onClose }: { onClose: () => void }) {
  return (
    <DocumentPanel
      title="Competitor Analysis"
      apiPath="competitor-analysis"
      downloadName="competitor-analysis"
      onClose={onClose}
    />
  );
}
