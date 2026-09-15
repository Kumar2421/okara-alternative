"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import { useToast } from "@/components/dashboard/Toast";
import BrandIcon from "@/components/settings/BrandIcon";

/** Real GitHub PAT + repo, validated live against the GitHub API before
 * either is saved (same honesty pattern as every other credential card
 * here — never store something that doesn't actually work). Powers the
 * code-fix agent: SEO findings → real file read → LLM patch → real PR. */
export default function GitHubCodeFixCard() {
  const { show } = useToast();
  const [connected, setConnected] = useState(false);
  const [repoSaved, setRepoSaved] = useState("");
  const [patInput, setPatInput] = useState("");
  const [repoInput, setRepoInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: { settings: { key: string; value: string }[] }) => {
        const patRow = data.settings?.find((s) => s.key === "github_pat");
        const repoRow = data.settings?.find((s) => s.key === "github_repo");
        if (patRow?.value && repoRow?.value) {
          setConnected(true);
          setRepoSaved(repoRow.value);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  async function saveSetting(key: string, value: string) {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Failed to save");
  }

  async function handleConnect() {
    if (!patInput.trim() || !repoInput.trim()) {
      show("Enter both a token and a repository (owner/repo).");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/settings/github/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: patInput.trim(), repo: repoInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        show(data.error || "Couldn't verify token/repo.");
        return;
      }
      await saveSetting("github_pat", patInput.trim());
      await saveSetting("github_repo", data.fullName);
      setConnected(true);
      setRepoSaved(data.fullName);
      setPatInput("");
      setRepoInput("");
      show(`Connected to ${data.fullName} — fixable SEO findings can now open real PRs.`);
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to connect GitHub.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    try {
      await saveSetting("github_pat", "");
      await saveSetting("github_repo", "");
      setConnected(false);
      setRepoSaved("");
      show("GitHub disconnected.");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to disconnect GitHub.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <BrandIcon id="github" color="#111111" fallback="G" />
          <div>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-900">
              GitHub — Code Fix Agent
              {connected && (
                <span className="flex items-center gap-1 rounded-full bg-[#e6f7f4] px-2 py-0.5 text-[10px] font-medium text-[#00846f]">
                  <Check size={10} /> Connected
                </span>
              )}
            </div>
            <div className="text-[12px] text-gray-500">
              Lets fixable SEO findings (meta tags, canonical, OG/Twitter tags, robots.txt) open real draft
              PRs against your repo. Fine-grained token needs Contents + Pull requests read/write on this
              one repo — never request org-wide access.
            </div>
          </div>
        </div>
        <a
          href="https://github.com/settings/personal-access-tokens/new"
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700"
        >
          Create token <ExternalLink size={11} />
        </a>
      </div>

      {!loaded ? null : connected ? (
        <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
          <span className="font-mono">{repoSaved}</span>
          <button onClick={handleDisconnect} disabled={busy} className="font-medium text-red-600 hover:underline disabled:opacity-50">
            Disconnect
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            value={patInput}
            onChange={(e) => setPatInput(e.target.value)}
            placeholder="github_pat_..."
            type="password"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400"
          />
          <div className="flex gap-2">
            <input
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
              placeholder="yourname/yourrepo"
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400"
            />
            <button
              onClick={handleConnect}
              disabled={busy}
              className="shrink-0 rounded-lg bg-[#111111] px-3 py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
            >
              {busy ? "Verifying..." : "Connect"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
