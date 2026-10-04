"use client";

import { useCallback, useEffect, useState } from "react";
import type { OpportunityGroups, SearchOpportunity } from "@/lib/domain/search/searchOpportunities";

export const SEARCH_REFRESHED_EVENT = "marlo:search-refreshed";

type Response = { snapshot: { capturedAt: string } | null; opportunities?: OpportunityGroups };

const SECTIONS: Array<{ key: keyof Omit<OpportunityGroups, "changes">; title: string; hint: string }> = [
  { key: "ranking", title: "Closest to page one", hint: "Searches where you already show up, just below the top results." },
  { key: "ctr", title: "Rank well, but few click", hint: "A better title and description could win more of these clicks." },
  { key: "declining", title: "Slipping", hint: "You lost ground on these compared with the previous 28 days." },
  { key: "newQueries", title: "New this month", hint: "People just started finding you for these." },
  { key: "lostQueries", title: "No longer showing", hint: "You had views for these before, and none now." },
];

function OpportunityRow({ item }: { item: SearchOpportunity }) {
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[12px] font-medium text-gray-800" title={item.query}>
          {item.query}
        </span>
        {item.pageUrl && (
          <a
            href={item.pageUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[11px] text-gray-500 underline-offset-2 hover:underline"
          >
            Open page
          </a>
        )}
      </div>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-gray-500">
        {item.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="mb-1 text-[11px] uppercase text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}

/** What changed in the last 28 days, and which searches are worth acting on, from the saved search history. */
export function SearchOpportunitiesCard() {
  const [data, setData] = useState<Response | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    fetch("/api/agents/analytics/search/opportunities")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((json: Response) => {
        setData(json);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(SEARCH_REFRESHED_EVENT, load);
    return () => window.removeEventListener(SEARCH_REFRESHED_EVENT, load);
  }, [load]);

  if (failed) return <div className="mb-5 text-[11px] text-amber-600">⚠ Couldn&apos;t load search opportunities.</div>;
  if (data === undefined) return <div className="mb-5 text-[11px] text-gray-400">Loading search opportunities…</div>;
  if (!data.snapshot || !data.opportunities) {
    return (
      <div className="mb-5 rounded-xl border border-dashed border-gray-200 p-4 text-[12px] text-gray-500">
        Save your search history with <strong>Refresh now</strong> above to see what changed and where to focus.
      </div>
    );
  }

  const { changes } = data.opportunities;
  const visible = SECTIONS.filter((section) => data.opportunities![section.key].length > 0);

  return (
    <div className="mb-5">
      <h4 className="text-[12px] font-semibold text-gray-700">What changed in the last 28 days</h4>
      <p className="mb-2 text-[11px] text-gray-500">Compared with the 28 days before, across your most-viewed searches.</p>
      <div className="mb-4 grid grid-cols-4 gap-3">
        <Stat label="Improved" value={changes.up} />
        <Stat label="Slipping" value={changes.down} />
        <Stat label="New" value={changes.new} />
        <Stat label="No longer showing" value={changes.lost} />
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-gray-200 p-3 text-sm text-gray-500">
          Nothing stands out right now. Check back after the next daily update.
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((section) => (
            <div key={section.key} className="rounded-xl border border-gray-200 bg-white p-4">
              <h5 className="text-[12px] font-semibold text-gray-700">{section.title}</h5>
              <p className="mb-1 text-[11px] text-gray-500">{section.hint}</p>
              <ul className="divide-y divide-gray-100">
                {data.opportunities![section.key].map((item) => (
                  <OpportunityRow key={`${item.type}:${item.query}`} item={item} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
