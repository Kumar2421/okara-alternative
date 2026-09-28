import { Layers, BarChart2, Users, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";

export type MobileTab = "context" | "analytics" | "agents" | "chat";

const TABS: { key: MobileTab; label: string; icon: ReactNode }[] = [
  { key: "context", label: "Context", icon: <Layers size={18} /> },
  { key: "analytics", label: "Analytics", icon: <BarChart2 size={18} /> },
  { key: "agents", label: "Leads", icon: <Users size={18} /> },
  { key: "chat", label: "Chat", icon: <MessageSquare size={18} /> },
];

export default function MobileTabBar({
  active,
  onChange,
}: {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-around border-t border-gray-200 bg-white py-1.5 [padding-bottom:calc(0.375rem+env(safe-area-inset-bottom))]">
      {TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-medium transition-colors ${
              isActive ? "text-gray-900" : "text-gray-400"
            }`}
          >
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full ${
                isActive ? "bg-gray-100" : ""
              }`}
            >
              {tab.icon}
            </span>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
