"use client";

import { Suspense } from "react";
import PageSpeedCard from "@/components/settings/PageSpeedCard";
import TavilyCard from "@/components/settings/TavilyCard";
import GoogleCloudCard from "@/components/settings/GoogleCloudCard";
import GmailCard from "@/components/settings/GmailCard";
import GoogleAnalyticsCard from "@/components/settings/GoogleAnalyticsCard";
import CompetitorDiscoveryToggle from "@/components/settings/CompetitorDiscoveryToggle";

export default function ApiCredentialsPage() {
  return (
    <div className="max-w-3xl">
      <h1 className="text-[15px] font-semibold text-gray-900">API Credentials</h1>
      <p className="mb-4 text-[13px] text-gray-500">
        External services that ground agents in real data — separate from the LLM providers that
        do the writing.
      </p>

      <div className="space-y-3">
        <PageSpeedCard />
        <TavilyCard />
        <GoogleCloudCard />
        <Suspense fallback={null}>
          <GmailCard />
        </Suspense>
        <Suspense fallback={null}>
          <GoogleAnalyticsCard />
        </Suspense>
        <CompetitorDiscoveryToggle />
      </div>
    </div>
  );
}
