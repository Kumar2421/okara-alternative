"use client";

import { useState, useEffect } from "react";
import TerminalLog from "@/components/dashboard/TerminalLog";
import ContextPanel from "@/components/dashboard/ContextPanel";
import AnalyticsPanel from "@/components/dashboard/AnalyticsPanel";
import LeadsPanel from "@/components/dashboard/LeadsPanel";
// AgentsFeedPanel hidden (not deleted) — replaced by LeadsPanel in the same
// column slot. Re-import "@/components/dashboard/AgentsFeedPanel" to restore.
import ChatPanel from "@/components/dashboard/ChatPanel";
import Loading from "./loading";

const RAIL = "56px";

export default function Home() {
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
    <div className="flex h-screen flex-col bg-white">
      <TerminalLog />
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: cols }}>
        <ContextPanel open={contextOpen} onToggle={() => setContextOpen((v) => !v)} />
        <AnalyticsPanel open={analyticsOpen} onToggle={() => setAnalyticsOpen((v) => !v)} />
        <LeadsPanel open={agentsOpen} onToggle={() => setAgentsOpen((v) => !v)} />
        <ChatPanel open={chatOpen} onToggle={() => setChatOpen((v) => !v)} />
      </div>
    </div>
  );
}
