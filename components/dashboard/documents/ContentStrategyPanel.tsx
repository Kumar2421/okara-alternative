"use client";

import DocumentPanel from "./DocumentPanel";

export default function ContentStrategyPanel({ onClose }: { onClose: () => void }) {
  return (
    <DocumentPanel
      title="Content Strategy"
      apiPath="content-strategy"
      downloadName="content-strategy"
      onClose={onClose}
    />
  );
}
