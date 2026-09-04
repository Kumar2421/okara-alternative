"use client";

import DocumentPanel from "./DocumentPanel";

export default function DesignGuidePanel({ onClose }: { onClose: () => void }) {
  return (
    <DocumentPanel title="Design Guide" apiPath="design-guide" downloadName="design-guide" onClose={onClose} />
  );
}
