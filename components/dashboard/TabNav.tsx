"use client";

import { BarChart3, Users, Mail, Zap, Settings } from "lucide-react";

type TabOption = "dashboard" | "leads" | "agents" | "emails" | "settings";

const TABS = [
  {
    id: "dashboard" as TabOption,
    label: "Dashboard",
    icon: BarChart3,
    description: "Analytics & overview",
  },
  {
    id: "leads" as TabOption,
    label: "Leads",
    icon: Users,
    description: "Find & manage leads",
  },
  {
    id: "agents" as TabOption,
    label: "Agents",
    icon: Zap,
    description: "AI agents for outreach",
  },
  {
    id: "emails" as TabOption,
    label: "Emails",
    icon: Mail,
    description: "Campaign & follow-ups",
  },
];

export default function TabNav({
  active,
  onChange,
}: {
  active: TabOption;
  onChange: (tab: TabOption) => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-gray-200 bg-white px-6 py-0">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-[13px] font-medium border-b-2 transition-colors ${
              isActive
                ? "border-blue-600 text-gray-900"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
            title={tab.description}
          >
            <Icon size={15} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
