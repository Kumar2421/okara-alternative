"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronLeft,
  Globe,
  Cpu,
  SlidersHorizontal,
  Plug,
  Users,
  UserCircle,
  Shield,
  Smartphone,
} from "lucide-react";

const AI_CMO_ITEMS = [
  { href: "/settings/websites", label: "Websites", icon: Globe },
  { href: "/settings/llm-providers", label: "LLM Providers", icon: Cpu, dot: true },
  { href: "/settings/agents", label: "Agents", icon: SlidersHorizontal },
  { href: "/settings/integrations", label: "Integrations", icon: Plug },
  { href: "/settings/team", label: "Team", icon: Users, dot: true },
];

const CHAT_ITEMS = [{ href: "/settings/personalization", label: "Personalization", icon: UserCircle }];

const GENERAL_ITEMS = [
  { href: "/settings/account", label: "Account & Security", icon: Shield },
  { href: "/settings/devices", label: "Devices", icon: Smartphone },
];

function NavGroup({
  title,
  items,
  pathname,
}: {
  title?: string;
  items: { href: string; label: string; icon: React.ComponentType<{ size?: number }>; dot?: boolean }[];
  pathname: string;
}) {
  return (
    <div className="mb-5">
      {title && (
        <div className="mb-1 px-3 text-[11px] font-semibold tracking-wide text-gray-400">{title}</div>
      )}
      {items.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium ${
              active ? "bg-gray-100 text-gray-900" : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            <Icon size={15} />
            {item.label}
            {item.dot && <span className="h-1.5 w-1.5 rounded-full bg-[#00ab92]" />}
          </Link>
        );
      })}
    </div>
  );
}

export default function SettingsNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="w-64 shrink-0 border-r border-gray-100 px-3 py-6">
      <button
        onClick={() => router.push("/")}
        className="mb-6 flex items-center gap-2 px-1 text-2xl font-bold text-gray-900 hover:opacity-70"
      >
        <ChevronLeft size={20} />
        Settings
      </button>
      <NavGroup title="AI CMO" items={AI_CMO_ITEMS} pathname={pathname} />
      <NavGroup title="CHAT" items={CHAT_ITEMS} pathname={pathname} />
      <NavGroup title="GENERAL" items={GENERAL_ITEMS} pathname={pathname} />
    </div>
  );
}
