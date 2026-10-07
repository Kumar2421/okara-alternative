"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";
import BrandIcon from "@/components/settings/BrandIcon";
import { useGithubStatus } from "@/components/dashboard/findings/useCodeFix";
import { fetchJson } from "@/lib/query/fetchJson";
import { useProject } from "@/lib/project-store";

/**
 * Hosted GitHub connection: install the Marlo GitHub App on chosen repositories, pick the one repo
 * this project's fixes go to, and disconnect. Marlo keeps only the installation and repo name.
 */
export default function GitHubAppCard() {
  const { show } = useToast();
  const { project } = useProject();
  const queryClient = useQueryClient();
  const status = useGithubStatus(true, true);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const gh = status.data;

  // GitHub sends people back here with ?github=connected or ?github_error=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("github_error");
    if (error) show(`GitHub: ${error}`);
    else if (params.get("github") === "connected") show("GitHub connected. Choose the repository for this project.");
    if (error || params.get("github")) {
      params.delete("github_error");
      params.delete("github");
      const query = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
    }
  }, [show]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["project", project?.id ?? "none", "github-status"] });

  async function saveRepo() {
    if (!choice) return;
    setBusy(true);
    try {
      await fetchJson("/api/github/app/repo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repo: choice }) });
      await refresh();
      show(`Marlo will open pull requests on ${choice}.`);
      setChoice("");
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't save the repository.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await fetchJson("/api/github/app/disconnect", { method: "POST" });
      await refresh();
      show("GitHub disconnected. Marlo no longer has access. Pull requests already opened stay open.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Couldn't disconnect GitHub.");
    } finally {
      setBusy(false);
    }
  }

  const installed = Boolean(gh?.connected || gh?.needsRepo);
  const returnTo = "/settings/integrations";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <BrandIcon id="github" color="#111111" fallback="G" />
          <div>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-900">
              GitHub: Code Fix Agent
              {gh?.connected && (
                <span className="flex items-center gap-1 rounded-full bg-[#e6f7f4] px-2 py-0.5 text-[10px] font-medium text-[#00846f]">
                  <Check size={10} /> Connected
                </span>
              )}
            </div>
            <div className="mt-1 text-[12px] text-gray-500">
              Install the Marlo GitHub App on one repository per project. For simple copy and markup fixes Marlo shows you a preview, then opens a pull request. It never merges; you do.
            </div>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-[#e6f7f4] px-2 py-0.5 text-[10px] font-medium text-[#00846f]">GitHub App</span>
      </div>

      {status.isPending ? (
        <div className="h-9 animate-pulse rounded-lg bg-gray-100" aria-busy="true" />
      ) : !installed ? (
        <a href={`/api/github/app/install?returnTo=${encodeURIComponent(returnTo)}`} className="inline-flex rounded-lg bg-[#111111] px-3 py-2 text-[13px] font-medium text-white hover:bg-black">
          Connect GitHub
        </a>
      ) : (
        <div className="space-y-2">
          {gh?.connected && (
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
              <span className="font-mono">{gh.repoFullName}</span>
              <button onClick={disconnect} disabled={busy} className="font-medium text-red-600 hover:underline disabled:opacity-50">Disconnect</button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              aria-label="Repository"
              className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800"
            >
              <option value="">{gh?.connected ? "Switch repository..." : "Choose a repository..."}</option>
              {(gh?.repos ?? []).map((r) => (
                <option key={r.fullName} value={r.fullName}>{r.fullName}{r.private ? " (private)" : ""}</option>
              ))}
            </select>
            <button onClick={saveRepo} disabled={busy || !choice} className="shrink-0 rounded-lg bg-[#111111] px-3 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50">
              {busy ? "Saving..." : "Use repository"}
            </button>
          </div>
          {gh && !gh.connected && (
            <button onClick={disconnect} disabled={busy} className="text-[11px] font-medium text-red-600 hover:underline disabled:opacity-50">Disconnect</button>
          )}
          {gh?.slug && (
            <p className="text-[11px] text-gray-400">
              Missing a repository?{" "}
              <a href={`https://github.com/apps/${gh.slug}/installations/new`} target="_blank" rel="noreferrer" className="underline">
                Add it in GitHub
              </a>
              , then refresh.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
