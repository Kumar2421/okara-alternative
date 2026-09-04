"use client";

import { user } from "@/lib/mock-data";
import { useToast } from "@/components/dashboard/Toast";

export default function TeamPage() {
  const { show } = useToast();

  return (
    <div className="max-w-2xl">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-[15px] font-semibold text-gray-900">Team</h1>
          <p className="text-[13px] text-gray-500">Manage who has access to this workspace.</p>
        </div>
        <button
          onClick={() => show("Invite teammate — coming soon.")}
          className="rounded-lg bg-[#111111] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-black"
        >
          + Invite
        </button>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#8a8a8a] text-[11px] font-semibold text-white">
            {user.initials}
          </div>
          <div>
            <div className="text-[13px] font-semibold text-gray-900">{user.name}</div>
            <div className="text-[12px] text-gray-500">{user.email}</div>
          </div>
        </div>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600">Owner</span>
      </div>
    </div>
  );
}
