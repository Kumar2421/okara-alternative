import SettingsNav from "@/components/settings/SettingsNav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-white text-gray-900">
      <SettingsNav />
      <div className="flex-1 px-10 py-8">{children}</div>
    </div>
  );
}
