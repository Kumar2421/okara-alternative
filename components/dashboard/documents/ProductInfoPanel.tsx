"use client";

import DocumentPanel from "./DocumentPanel";

export default function ProductInfoPanel({ onClose }: { onClose: () => void }) {
  return (
    <DocumentPanel
      title="Product Information"
      apiPath="product-info"
      downloadName="product-information"
      onClose={onClose}
    />
  );
}
