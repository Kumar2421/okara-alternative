"use client";

import { user } from "@/lib/mock-data";
import { useToast } from "@/components/dashboard/Toast";

export default function AccountPage() {
  const { show } = useToast();

  return (
    <div className="max-w-2xl">
      <h1 className="text-[15px] font-semibold text-gray-900">Account & Security</h1>
      <p className="mb-4 text-[13px] text-gray-500">Manage your login and account protection.</p>

      <div className="mb-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div className="mb-1 text-[13px] font-semibold text-gray-900">Email</div>
        <div className="text-[13px] text-gray-600">{user.email}</div>
      </div>

      <div className="mb-4 flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div>
          <div className="text-[13px] font-semibold text-gray-900">Password</div>
          <div className="text-[12px] text-gray-500">Last changed 3 months ago</div>
        </div>
        <button
          onClick={() => show("Change password — coming soon.")}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-[13px] font-medium text-gray-600 hover:bg-gray-50"
        >
          Change
        </button>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3">
        <div>
          <div className="text-[13px] font-semibold text-gray-900">Two-factor authentication</div>
          <div className="text-[12px] text-gray-500">Add an extra layer of security to your account.</div>
        </div>
        <button
          onClick={() => show("2FA setup — coming soon.")}
          className="rounded-lg bg-[#111111] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-black"
        >
          Enable
        </button>
      </div>
    </div>
  );
}
