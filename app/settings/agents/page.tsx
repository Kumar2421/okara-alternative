"use client";

import { useState } from "react";
import { Globe, Save } from "lucide-react";
import Toggle from "@/components/settings/Toggle";
import { useToast } from "@/components/dashboard/Toast";

type AgentToggleState = Record<string, boolean>;

const PLATFORM_AGENTS = [
  { id: "x", name: "X / Twitter", desc: "The tone and voice for posts on X.", iconBg: "#111111", icon: "𝕏" },
  { id: "linkedin", name: "LinkedIn", desc: "The tone and voice for LinkedIn posts.", iconBg: "#0a66c2", icon: "in" },
  { id: "articles", name: "Articles", desc: "How the agent writes long-form content.", iconBg: "#8b5cf6", icon: "📝" },
];

export default function AgentsSettingsPage() {
  const { show } = useToast();
  const [toggles, setToggles] = useState<AgentToggleState>({
    seo: true,
    reddit: true,
    x: true,
    linkedin: true,
    articles: true,
  });
  const [region, setRegion] = useState("United States (English)");
  const [redditPrompt, setRedditPrompt] = useState("");
  const [searchRegion, setSearchRegion] = useState("Global (no filter)");

  function setToggle(id: string, v: boolean) {
    setToggles((t) => ({ ...t, [id]: v }));
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-[15px] font-semibold text-gray-900">Agents</h1>
          <p className="text-[13px] text-gray-500">Platform instructions, toggles, and brand voice.</p>
        </div>
        <button
          onClick={() => show("Settings saved.")}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-[13px] font-medium text-gray-500 hover:bg-gray-100"
        >
          <Save size={13} /> Save
        </button>
      </div>

      <div className="mb-4 rounded-xl border border-gray-200 p-4">
        <div className="mb-3 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Globe size={16} className="text-blue-500" />
            <div>
              <div className="text-[13px] font-semibold text-gray-900">SEO Analysis</div>
              <div className="text-[12px] text-gray-500">The market your search and AI-visibility data is tracked for.</div>
            </div>
          </div>
          <Toggle checked={toggles.seo} onChange={(v) => setToggle("seo", v)} />
        </div>
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          disabled={!toggles.seo}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 disabled:opacity-50"
        >
          <option>United States (English)</option>
          <option>United Kingdom (English)</option>
          <option>India (English)</option>
          <option>Germany (German)</option>
        </select>
        <p className="mt-2 text-[11px] text-gray-400">
          Applies on the next run. Past data from other markets is kept; ChatGPT data stays US-only.
        </p>
      </div>

      <div className="mb-4 rounded-xl border border-gray-200 p-4">
        <div className="mb-3 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ff4500] text-[11px] text-white">
              🤖
            </span>
            <div>
              <div className="text-[13px] font-semibold text-gray-900">Reddit</div>
              <div className="text-[12px] text-gray-500">How replies should read, and where the agent looks.</div>
            </div>
          </div>
          <Toggle checked={toggles.reddit} onChange={(v) => setToggle("reddit", v)} />
        </div>
        <textarea
          value={redditPrompt}
          onChange={(e) => setRedditPrompt(e.target.value)}
          disabled={!toggles.reddit}
          placeholder="Sound like a helpful user, keep replies concise, avoid over-promotional language…"
          className="mb-3 h-24 w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400 disabled:opacity-50"
        />
        <label className="mb-1 flex items-center gap-1 text-[12px] text-gray-600">Search region</label>
        <select
          value={searchRegion}
          onChange={(e) => setSearchRegion(e.target.value)}
          disabled={!toggles.reddit}
          className="mb-3 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 disabled:opacity-50"
        >
          <option>Global (no filter)</option>
          <option>United States only</option>
        </select>
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between text-[12px] text-gray-600">
            Priority subreddits
            <span className="text-gray-400">0/20</span>
          </div>
          <button
            onClick={() => show("Add subreddit — coming soon.")}
            disabled={!toggles.reddit}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-[13px] text-gray-400 hover:bg-gray-50 disabled:opacity-50"
          >
            + Add <span className="text-gray-400">Add subreddits to focus your search</span>
          </button>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-[12px] text-gray-600">
            Search keywords
            <span className="text-gray-400">0/30</span>
          </div>
          <button
            onClick={() => show("Add keyword — coming soon.")}
            disabled={!toggles.reddit}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-[13px] text-gray-400 hover:bg-gray-50 disabled:opacity-50"
          >
            + Add <span className="text-gray-400">None added</span>
          </button>
        </div>
      </div>

      {PLATFORM_AGENTS.filter((a) => a.id !== "articles").map((agent) => (
        <div key={agent.id} className="mb-4 rounded-xl border border-gray-200 p-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span
                className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                style={{ backgroundColor: agent.iconBg }}
              >
                {agent.icon}
              </span>
              <div>
                <div className="text-[13px] font-semibold text-gray-900">{agent.name}</div>
                <div className="text-[12px] text-gray-500">{agent.desc}</div>
              </div>
            </div>
            <Toggle checked={toggles[agent.id]} onChange={(v) => setToggle(agent.id, v)} />
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
            <div>
              <div className="text-[12px] text-gray-600">Brand voice</div>
              <div className="text-[11px] text-gray-400">Used when the agent writes for this platform.</div>
            </div>
            <div className="flex items-center gap-3 text-[12px]">
              <button onClick={() => show("Write your own — coming soon.")} className="text-gray-600 hover:text-gray-900">
                Write your own
              </button>
              <button
                onClick={() => show(`Setting up your ${agent.name} brand voice...`)}
                className="text-gray-600 hover:text-gray-900"
              >
                ✨ Set up my {agent.name} brand voice
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
