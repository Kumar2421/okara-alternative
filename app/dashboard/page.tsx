"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import TerminalLog from "@/components/dashboard/TerminalLog";
import ContextPanel from "@/components/dashboard/ContextPanel";
import AnalyticsPanel from "@/components/dashboard/AnalyticsPanel";
import LeadsPanel from "@/components/dashboard/LeadsPanel";
// AgentsFeedPanel hidden (not deleted) — replaced by LeadsPanel in the same
// column slot. Re-import "@/components/dashboard/AgentsFeedPanel" to restore.
import ChatPanel from "@/components/dashboard/ChatPanel";
import Loading from "../loading";
import { DashboardDataProvider, useDashboardData } from "@/lib/dashboard-data";

const RAIL = "56px";

/** First-time users with no project yet get sent to /onboarding instead of
 * a dashboard full of empty panels — driven by the same /api/project/data
 * fetch every panel already needs, via the dashboard data provider this
 * page already mounts. Any other fetch failure (real 500, network) is left
 * alone here; only the specific "no project" 404 redirects. */
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { data, loading, error } = useDashboardData();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !data && error === "No active project") {
      router.replace("/onboarding");
    }
  }, [loading, data, error, router]);

  if (!loading && !data && error === "No active project") return null;
  return <>{children}</>;
}

export default function DashboardPage() {
  const [contextOpen, setContextOpen] = useState(true);
  const [analyticsOpen, setAnalyticsOpen] = useState(true);
  const [agentsOpen, setAgentsOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 900);
    return () => clearTimeout(t);
  }, []);

  const cols = [
    contextOpen ? "22%" : RAIL,
    analyticsOpen ? "26%" : RAIL,
    agentsOpen ? "26%" : RAIL,
    chatOpen ? "1fr" : RAIL,
  ].join(" ");

  if (booting) return <Loading />;

  return (
    <DashboardDataProvider>
      <OnboardingGate>
        <div className="flex h-screen flex-col bg-white">
          <TerminalLog />
          <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: cols }}>
            <ContextPanel open={contextOpen} onToggle={() => setContextOpen((v) => !v)} />
            <Suspense fallback={null}>
              <AnalyticsPanel open={analyticsOpen} onToggle={() => setAnalyticsOpen((v) => !v)} />
            </Suspense>
            <LeadsPanel open={agentsOpen} onToggle={() => setAgentsOpen((v) => !v)} />
            <ChatPanel open={chatOpen} onToggle={() => setChatOpen((v) => !v)} />
          </div>
        </div>
      </OnboardingGate>
    </DashboardDataProvider>
  );
}
