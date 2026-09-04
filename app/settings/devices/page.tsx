"use client";

import { Laptop, Smartphone } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";

const DEVICES = [
  { id: "1", name: "Windows PC · Chrome", location: "Bengaluru, IN", current: true, icon: Laptop },
  { id: "2", name: "iPhone · Safari", location: "Bengaluru, IN", current: false, icon: Smartphone },
];

export default function DevicesPage() {
  const { show } = useToast();

  return (
    <div className="max-w-2xl">
      <h1 className="text-[15px] font-semibold text-gray-900">Devices</h1>
      <p className="mb-4 text-[13px] text-gray-500">Devices currently signed in to your account.</p>

      <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        {DEVICES.map((d) => (
          <div key={d.id} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <d.icon size={18} className="text-gray-400" />
              <div>
                <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-900">
                  {d.name}
                  {d.current && (
                    <span className="rounded-full bg-[#e6f7f4] px-2 py-0.5 text-[11px] font-medium text-[#00846f]">
                      This device
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-gray-500">{d.location}</div>
              </div>
            </div>
            {!d.current && (
              <button
                onClick={() => show(`Signed out of ${d.name}.`)}
                className="text-[13px] font-medium text-red-600 hover:underline"
              >
                Sign out
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
