"use client";

import { Info } from "lucide-react";
import ProviderCard from "@/components/settings/ProviderCard";
import PageSpeedCard from "@/components/settings/PageSpeedCard";
import TavilyCard from "@/components/settings/TavilyCard";
import CompetitorDiscoveryToggle from "@/components/settings/CompetitorDiscoveryToggle";
import { providers } from "@/lib/mock-providers";
import { useProviders } from "@/lib/providers-store";

export default function LlmProvidersPage() {
  const { connectedModels, primaryModel } = useProviders();

  return (
    <div className="max-w-3xl">
      <h1 className="text-[15px] font-semibold text-gray-900">LLM Providers</h1>
      <p className="mb-4 text-[13px] text-gray-500">
        Connect the model providers your agents can use. Pick one model as primary — that's what
        the chat and agents default to.
      </p>

      <div className="mb-5 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] text-gray-600">
        <Info size={14} className="shrink-0 text-gray-400" />
        {connectedModels.length === 0
          ? "No providers connected yet. Connect at least one to start using the chat and agents."
          : primaryModel
            ? `Primary model: ${primaryModel}`
            : "Providers connected — pick a primary model on any connected card."}
      </div>

      <div className="space-y-3">
        {providers.map((p) => (
          <ProviderCard key={p.id} provider={p} />
        ))}
      </div>

      <div className="mt-8">
        <h2 className="text-[15px] font-semibold text-gray-900">API Services</h2>
        <p className="mb-4 text-[13px] text-gray-500">
          Connect external services for data enrichment.
        </p>
        <div className="space-y-3">
          <PageSpeedCard />
          <TavilyCard />
          <CompetitorDiscoveryToggle />
        </div>
      </div>
    </div>
  );
}
