"use client";

import { Pencil } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";

export default function WebsitesPage() {
  const { show } = useToast();

  return (
    <div className="max-w-2xl">
      <h1 className="text-[15px] font-semibold text-gray-900">Websites</h1>
      <p className="mb-4 text-[13px] text-gray-500">Select a website to manage its settings and URL.</p>

      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-base">
            🌐
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-gray-900">mlforge Invoice</span>
              <span className="rounded-full bg-[#e6f7f4] px-2 py-0.5 text-[11px] font-medium text-[#00846f]">
                Primary
              </span>
            </div>
            <div className="text-[12px] text-gray-500">invoice.mlforge.in</div>
          </div>
        </div>
        <button
          onClick={() => show("Edit website settings — coming soon.")}
          className="flex items-center gap-1 text-[13px] font-medium text-gray-600 hover:text-gray-900"
        >
          <Pencil size={13} /> Edit
        </button>
      </div>
    </div>
  );
}
