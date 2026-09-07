"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, ChevronLeft, Loader2, RefreshCw, X, ExternalLink, Mail, Search, Phone, Building2 } from "lucide-react";
import CollapsedRail, { RailButton } from "./CollapsedRail";
import { useToast } from "./Toast";
import { useProject } from "@/lib/project-store";
import { useProviders, findProviderForModel } from "@/lib/providers-store";
import { useTerminalLog } from "@/lib/terminal-log-store";
import ComposeEmailModal from "./ComposeEmailModal";

type Lead = {
  id: string;
  name: string;
  title: string;
  company: string;
  location: string;
  email: string | null;
  email_verified?: number | boolean;
  source_url: string | null;
  query: string;
  created_at: string;
  phone?: string | null;
  place_id?: string | null;
  lead_type?: "person" | "business";
  email_status?: "sent" | "failed" | null;
  emailed_at?: string | null;
};

export default function LeadsPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"person" | "business">("person");
  const [role, setRole] = useState("");
  const [companyOrIndustry, setCompanyOrIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");
  const [bizLocation, setBizLocation] = useState("");
  const [gmailConnected, setGmailConnected] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const { show } = useToast();
  const { project } = useProject();
  const { primaryModel } = useProviders();
  const { log, logDone } = useTerminalLog();

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agents/leads/search");
      const data = await res.json();
      setLeads(data.leads ?? []);
    } catch {
      // route unreachable — list just stays empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && project) loadLeads();
  }, [open, project?.id, loadLeads]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: { settings: { key: string; value: string }[] }) => {
        setGmailConnected(!!data.settings?.find((s) => s.key === "gmail_email")?.value);
      })
      .catch(() => {});
  }, [open]);

  async function handleSearch() {
    if (!role.trim() && !companyOrIndustry.trim()) {
      show("Enter at least a role or a company/industry to search for.");
      return;
    }
    if (!primaryModel) {
      show("No primary model selected. Configure LLM Providers in Settings.");
      return;
    }
    const providerId = findProviderForModel(primaryModel);
    if (!providerId) {
      show("Could not determine provider for the selected model.");
      return;
    }

    setSearching(true);
    const filters = [role, companyOrIndustry, location].filter(Boolean).join(" · ") || "(no filters)";
    log(`Searching leads: ${filters}...`);
    log("Running real web searches (Tavily) and extracting real people from the results...");
    log("Then SMTP-verifying a guessed email for any lead search didn't find one for — this can take a minute...");
    try {
      const res = await fetch("/api/agents/leads/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, companyOrIndustry, location, model: primaryModel, providerId }),
      });
      const data = await res.json();
      if (!res.ok) {
        log(`⚠ ${data.error ?? "Failed to search leads"}`);
        show(data.error || "Failed to search leads.");
        return;
      }
      const found: Lead[] = data.leads ?? [];
      setLeads((prev) => [...found, ...prev]);

      const foundEmail = found.filter((l) => l.email && !l.email_verified).length;
      const verifiedEmail = found.filter((l) => l.email_verified).length;
      const noEmail = found.length - foundEmail - verifiedEmail;
      logDone(
        `Found ${found.length} lead${found.length === 1 ? "" : "s"} — ${foundEmail} email${foundEmail === 1 ? "" : "s"} from search, ${verifiedEmail} SMTP-verified, ${noEmail} with no email.`
      );
      show(`Found ${found.length} lead${found.length === 1 ? "" : "s"}.`);
    } catch {
      log("⚠ Failed to search leads.");
      show("Failed to search leads.");
    } finally {
      setSearching(false);
    }
  }

  async function handleBizSearch() {
    if (!category.trim() || !bizLocation.trim()) {
      show("Enter both a category and a location.");
      return;
    }

    setSearching(true);
    log(`Searching local businesses: ${category} in ${bizLocation}...`);
    try {
      const res = await fetch("/api/agents/leads/places-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, location: bizLocation }),
      });
      const data = await res.json();
      if (!res.ok) {
        log(`⚠ ${data.error ?? "Failed to search local businesses"}`);
        show(data.error || "Failed to search local businesses.");
        return;
      }
      const found: Lead[] = data.leads ?? [];
      setLeads((prev) => [...found, ...prev]);
      logDone(`Found ${found.length} real local business${found.length === 1 ? "" : "es"}.`);
      show(`Found ${found.length} business${found.length === 1 ? "" : "es"}.`);
    } catch {
      log("⚠ Failed to search local businesses.");
      show("Failed to search local businesses.");
    } finally {
      setSearching(false);
    }
  }

  async function handleRemove(id: string) {
    setLeads((prev) => prev.filter((l) => l.id !== id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    try {
      await fetch(`/api/agents/leads/search?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      show("Failed to remove lead — it may still be saved.");
      loadLeads();
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!open) {
    return (
      <CollapsedRail onExpand={onToggle}>
        <RailButton icon={<Users size={15} />} label="Leads" onClick={onToggle} />
      </CollapsedRail>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-gray-200 px-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-900">
          <Users size={15} className="text-gray-500" />
          Leads
          {leads.length > 0 && <span className="text-[11px] font-normal text-gray-400">({leads.length})</span>}
        </div>
        <button onClick={onToggle} title="Collapse" className="text-gray-400 hover:text-gray-700">
          <ChevronLeft size={15} />
        </button>
      </div>

      <div className="shrink-0 space-y-2 border-b border-gray-200 p-3">
        <div className="mb-1 flex rounded-lg bg-gray-100 p-0.5 text-[12px]">
          <button
            onClick={() => setMode("person")}
            className={`flex-1 rounded-md py-1.5 font-medium ${mode === "person" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
          >
            People
          </button>
          <button
            onClick={() => setMode("business")}
            className={`flex-1 rounded-md py-1.5 font-medium ${mode === "business" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
          >
            Local Business
          </button>
        </div>

        {mode === "person" ? (
          <>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Role — e.g. VP Marketing"
              className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400"
            />
            <input
              value={companyOrIndustry}
              onChange={(e) => setCompanyOrIndustry(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Company or industry — e.g. B2B SaaS"
              className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400"
            />
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Location — e.g. Austin, TX"
              className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400"
            />
            <button
              onClick={handleSearch}
              disabled={searching || !project}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#111111] py-1.5 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
            >
              {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              {searching ? "Searching..." : "Search Leads"}
            </button>
          </>
        ) : (
          <>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleBizSearch()}
              placeholder="Category — e.g. dentist, gym, coffee shop"
              className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400"
            />
            <input
              value={bizLocation}
              onChange={(e) => setBizLocation(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleBizSearch()}
              placeholder="Location — e.g. Austin, TX"
              className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400"
            />
            <button
              onClick={handleBizSearch}
              disabled={searching || !project}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#111111] py-1.5 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
            >
              {searching ? <Loader2 size={13} className="animate-spin" /> : <Building2 size={13} />}
              {searching ? "Searching..." : "Search Businesses"}
            </button>
            <p className="text-[11px] text-gray-400">Real Places API data — needs a Google Cloud key in Settings.</p>
          </>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2">
          <span className="text-[12px] text-gray-600">{selected.size} selected</span>
          <button
            onClick={() => setComposeOpen(true)}
            disabled={!gmailConnected}
            title={gmailConnected ? "Compose an outreach email" : "Connect Gmail in Settings → API Credentials first"}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
              gmailConnected ? "border-gray-200 text-gray-700 hover:bg-gray-100" : "border-gray-200 text-gray-400"
            }`}
          >
            <Mail size={11} /> Email Selected
          </button>
        </div>
      )}

      {composeOpen && (
        <ComposeEmailModal
          leads={leads.filter((l) => selected.has(l.id))}
          onClose={() => setComposeOpen(false)}
          onSent={(results) => {
            const byId = new Map(results.map((r) => [r.id, r]));
            setLeads((prev) =>
              prev.map((l) => {
                const r = byId.get(l.id);
                if (!r) return l;
                return { ...l, email_status: r.status, emailed_at: r.status === "sent" ? new Date().toISOString() : l.emailed_at };
              })
            );
            const sentCount = results.filter((r) => r.status === "sent").length;
            show(`Sent ${sentCount} of ${results.length} email${results.length === 1 ? "" : "s"}.`);
            setSelected(new Set());
          }}
        />
      )}

      <div className="okara-scroll flex-1 overflow-y-auto">
        {!project ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Users size={18} className="text-gray-300" />
            <p className="text-[13px] text-gray-500">Link a website first to search for leads.</p>
          </div>
        ) : loading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Search size={18} className="text-gray-300" />
            <p className="text-[13px] font-medium text-gray-700">No leads yet</p>
            <p className="max-w-[220px] text-[12px] text-gray-500">
              Search by role, company, or location above — real people pulled from real web search
              results, never invented.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {leads.map((lead) => (
              <div key={lead.id} className="group flex gap-2.5 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={selected.has(lead.id)}
                  onChange={() => toggleSelected(lead.id)}
                  className="mt-1 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-gray-900">{lead.name}</span>
                    <button
                      onClick={() => handleRemove(lead.id)}
                      className="shrink-0 text-gray-300 opacity-0 hover:text-gray-600 group-hover:opacity-100"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  {(lead.title || lead.company) && (
                    <div className="truncate text-[12px] text-gray-600">
                      {[lead.title, lead.company].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {lead.location && <div className="truncate text-[11px] text-gray-400">{lead.location}</div>}
                  {lead.phone && (
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-600">
                      <Phone size={10} /> {lead.phone}
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-2 text-[11px]">
                    {lead.lead_type === "business" ? null : lead.email ? (
                      <span
                        title={lead.email_verified ? "SMTP-verified guess — not found directly, but the mail server accepted it" : "Found directly in real search results"}
                        className="rounded-full bg-[#e6f7f4] px-2 py-0.5 font-medium text-[#00846f]"
                      >
                        {lead.email}
                        {!!lead.email_verified && " ✓ verified"}
                      </span>
                    ) : (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-400">No email found</span>
                    )}
                    {lead.source_url && (
                      <a
                        href={lead.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-0.5 text-gray-400 hover:text-gray-700"
                      >
                        {lead.lead_type === "business" ? "Website" : "Source"} <ExternalLink size={10} />
                      </a>
                    )}
                    {lead.email_status === "sent" && (
                      <span className="flex items-center gap-0.5 text-[#00846f]">
                        <Mail size={10} /> Sent
                      </span>
                    )}
                    {lead.email_status === "failed" && <span className="text-red-600">⚠ Send failed</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-gray-200 px-4 py-2.5 text-[11px] text-gray-400">
        <span>Emails are found in real search results or SMTP-verified — never shown unverified.</span>
        <button onClick={loadLeads} className="flex items-center gap-1 hover:text-gray-700">
          <RefreshCw size={11} /> Refresh
        </button>
      </div>
    </div>
  );
}
