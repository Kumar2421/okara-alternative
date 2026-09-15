"use client";

import { useState, useEffect, Suspense } from "react";
import TerminalLog from "@/components/dashboard/TerminalLog";
import TabNav from "@/components/dashboard/TabNav";
import ContextPanel from "@/components/dashboard/ContextPanel";
import AnalyticsPanel from "@/components/dashboard/AnalyticsPanel";
import LeadsPanel from "@/components/dashboard/LeadsPanel";
import ChatPanel from "@/components/dashboard/ChatPanel";
import AgentsChatPanel from "@/components/dashboard/AgentsChatPanel";
import Loading from "./loading";

type TabOption = "dashboard" | "leads" | "agents" | "emails" | "settings";

const RAIL = "56px";

export default function Home() {
  const [tab, setTab] = useState<TabOption>("dashboard");
  const [contextOpen, setContextOpen] = useState(true);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 900);
    return () => clearTimeout(t);
  }, []);

  if (booting) return <Loading />;

  return (
    <div className="flex h-screen flex-col bg-white">
      <TerminalLog />
      <TabNav active={tab} onChange={setTab} />

      <div className="flex flex-1 min-h-0">
        {/* Context sidebar (always visible on left) */}
        <div
          className="overflow-hidden transition-all"
          style={{ width: contextOpen ? "22%" : RAIL }}
        >
          <ContextPanel open={contextOpen} onToggle={() => setContextOpen((v) => !v)} />
        </div>

        {/* Main content area (switches per tab) */}
        <div className="flex-1 flex flex-col min-h-0 bg-white">
          {tab === "dashboard" && (
            <Suspense fallback={null}>
              <AnalyticsPanel open={true} onToggle={() => {}} />
            </Suspense>
          )}

          {tab === "leads" && (
            <Suspense fallback={null}>
              <LeadsPanel open={true} onToggle={() => {}} />
            </Suspense>
          )}

          {tab === "agents" && <AgentsChatPanel />}

          {tab === "emails" && (
            <div className="flex items-center justify-center text-gray-400">
              <p>Email campaigns coming soon</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
