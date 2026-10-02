"use client";

import { Loader2, Plus, XCircle } from "lucide-react";
import type { Action } from "@/lib/domain/actions/actionTypes";
import type { Recommendation } from "@/lib/domain/recommendations/recommendationTypes";

const STATUS_LABEL: Record<Action["status"], string> = {
  proposed: "Proposed",
  approved: "Approved",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STATUS_CLASS: Record<Action["status"], string> = {
  proposed: "border-amber-200 bg-amber-50 text-amber-700",
  approved: "border-blue-200 bg-blue-50 text-blue-700",
  running: "border-violet-200 bg-violet-50 text-violet-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  cancelled: "border-gray-200 bg-gray-50 text-gray-500",
};

export default function FindingActionsSection({
  recommendations,
  actions,
  loading,
  busyRecommendationId,
  onCreate,
  onCancel,
}: {
  recommendations: Recommendation[];
  actions: Action[];
  loading: boolean;
  busyRecommendationId: string | null;
  onCreate: (recommendation: Recommendation) => void;
  onCancel: (action: Action) => void;
}) {
  const latestByRecommendation = new Map<string, Action>();
  for (const action of actions) {
    if (!action.recommendationId) continue;
    if (!latestByRecommendation.has(action.recommendationId)) {
      latestByRecommendation.set(action.recommendationId, action);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 text-[12px] text-gray-500">
        <Loader2 size={13} className="animate-spin" />
        Loading tracked actions...
      </div>
    );
  }

  if (recommendations.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3 text-[12px] text-gray-500">
        No recommendations are available to turn into an action.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {recommendations.map((recommendation) => {
        const action = latestByRecommendation.get(recommendation.id);
        const busy = busyRecommendationId === recommendation.id;

        return (
          <div key={recommendation.id} className="rounded-xl border border-gray-200 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-gray-900">{recommendation.title}</div>
                <div className="mt-1 text-[11px] leading-4 text-gray-600">{recommendation.summary}</div>
              </div>
              {action ? (
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[9px] font-semibold uppercase text-gray-500">{recommendation.priority}</span>
                  <span className={"rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase " + STATUS_CLASS[action.status]}>
                  {STATUS_LABEL[action.status]}
                  </span>
                </span>
              ) : (
                <button
                  onClick={() => onCreate(recommendation)}
                  disabled={busy}
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-[#111111] px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-black disabled:opacity-50"
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Track action
                </button>
              )}
            </div>

            <div className="mt-2 text-[10px] text-gray-500">
              <span className="font-medium text-gray-700">{recommendation.implementation.kind}</span>
              {" · "}
              {recommendation.implementation.description}
            </div>

            {action?.status === "proposed" && (
              <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
                <span className="text-[10px] text-gray-400">Saved as a proposed action. No work is executed automatically.</span>
                <button
                  onClick={() => onCancel(action)}
                  disabled={busy}
                  className="flex items-center gap-1 text-[10px] font-medium text-gray-500 hover:text-red-600 disabled:opacity-50"
                >
                  <XCircle size={11} />
                  Cancel
                </button>
              </div>
            )}

            {action && action.status !== "proposed" && (
              <div className="mt-2 border-t border-gray-100 pt-2 text-[10px] text-gray-400">
                Action created {new Date(action.createdAt).toLocaleString()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
