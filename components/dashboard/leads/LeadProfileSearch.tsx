"use client";

import { useState } from "react";
import { Loader2, Search, Target } from "lucide-react";
import { describeProfile, type LeadProfile, type LeadSearchTarget } from "@/lib/domain/leads/leadProfile";

function Pick({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  if (options.length === 0) return null;
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      {options.length === 1 ? (
        <span className="block rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5 text-[12px] text-gray-800">{options[0]}</span>
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[12px] text-gray-800"
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}

/** The confirmed profile in one line, with a one-click search built from it. */
export default function LeadProfileSearch({
  profile,
  searching,
  disabled,
  onEdit,
  onSearch,
}: {
  profile: LeadProfile;
  searching: boolean;
  disabled: boolean;
  onEdit: () => void;
  onSearch: (target: LeadSearchTarget) => void;
}) {
  const [role, setRole] = useState(profile.roles[0] ?? "");
  const [industry, setIndustry] = useState(profile.industries[0] ?? "");
  const [location, setLocation] = useState(profile.locations[0] ?? "");

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Target size={14} className="mt-0.5 shrink-0 text-gray-400" />
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-gray-900">Your lead profile</div>
            <p className="mt-0.5 text-[11px] leading-4 text-gray-500">{describeProfile(profile)}</p>
          </div>
        </div>
        <button type="button" onClick={onEdit} className="shrink-0 text-[11px] font-medium text-gray-500 hover:text-gray-900 hover:underline">
          Edit
        </button>
      </div>

      <div className="space-y-2">
        <Pick label="Job title" options={profile.roles} value={role} onChange={setRole} />
        <Pick label="Company type" options={profile.industries} value={industry} onChange={setIndustry} />
        <Pick label="Location" options={profile.locations} value={location} onChange={setLocation} />
      </div>

      <button
        type="button"
        onClick={() => onSearch({ role, companyOrIndustry: industry, location })}
        disabled={searching || disabled}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#111111] py-1.5 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
      >
        {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
        {searching ? "Searching..." : "Find leads"}
      </button>
    </div>
  );
}
