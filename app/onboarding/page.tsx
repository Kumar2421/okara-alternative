"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { useProject } from "@/lib/project-store";
import { useToast } from "@/components/dashboard/Toast";

const SOURCE_OPTIONS = [
  "Google Search",
  "X / Twitter",
  "Reddit",
  "A friend or colleague",
  "Blog or newsletter",
  "Other",
];

const ROLE_OPTIONS = [
  "Founder / Solo builder",
  "Marketer",
  "Developer",
  "Agency",
  "Other",
];

// Real, implemented agents (app/api/agents/*) — not aspirational copy. Icon
// colors match the ones already used for these agents elsewhere (Agents
// settings page, ContextPanel) so this doesn't introduce a second palette.
const AGENTS = [
  { name: "SEO Agent", icon: "🔍", bg: "#2563eb" },
  { name: "Writer Agent", icon: "📝", bg: "#8b5cf6" },
  { name: "LinkedIn Agent", icon: "in", bg: "#0a66c2" },
  { name: "X / Twitter Agent", icon: "𝕏", bg: "#111111" },
  { name: "Reddit Agent", icon: "🤖", bg: "#ff4500" },
  { name: "GEO Agent", icon: "🌐", bg: "#0ea5a4" },
  { name: "Coding Agent", icon: "⌥", bg: "#24292f" },
  { name: "Leads Agent", icon: "👤", bg: "#4f46e5" },
  { name: "HN Agent", icon: "Y", bg: "#ff6600" },
];

function OkaraMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <circle cx="14" cy="14" r="13" fill="#111111" />
      <circle cx="18.5" cy="9.5" r="7" fill="#ffffff" fillOpacity="0.95" />
      <circle cx="18.5" cy="9.5" r="3.2" fill="#111111" />
    </svg>
  );
}

function deriveProjectName(url: string): string {
  try {
    const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
    const base = host.split(".")[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return url;
  }
}

async function saveSetting(key: string, value: string) {
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  }).catch(() => {});
}

export default function OnboardingPage() {
  const router = useRouter();
  const { show } = useToast();
  const { createProject, projects, loading: projectsLoading } = useProject();

  const [source, setSource] = useState(SOURCE_OPTIONS[0]);
  const [role, setRole] = useState(ROLE_OPTIONS[0]);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  // Already has a project (e.g. navigated back here manually) — nothing left
  // to onboard, go straight to the dashboard instead of asking again.
  useEffect(() => {
    if (!projectsLoading && projects.length > 0) {
      router.replace("/dashboard");
    }
  }, [projectsLoading, projects, router]);

  async function handleContinue() {
    if (!url.trim()) {
      show("Enter your website URL to get started.");
      return;
    }
    setSaving(true);
    try {
      await Promise.all([
        saveSetting("onboarding_source", source),
        saveSetting("personalization_role", role),
        saveSetting("onboarding_completed", "true"),
      ]);
      await createProject({ name: deriveProjectName(url.trim()), url: url.trim() });
      router.replace("/dashboard");
    } catch (err) {
      show(err instanceof Error ? err.message : "Failed to set up your site.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="h-screen overflow-hidden bg-white p-3 text-black antialiased">
      <div className="grid h-[calc(100vh-1.5rem)] gap-6 lg:grid-cols-[0.94fr_1.06fr]">
        {/* Left: onboarding form */}
        <div className="flex items-center justify-center overflow-hidden rounded-md border border-black/10 bg-white px-6 sm:px-10 lg:px-14 xl:px-16">
          <div className="w-full max-w-[420px]">
            <div className="mb-2 flex items-center gap-2">
              <OkaraMark className="h-[24px] w-[24px]" />
              <span className="text-sm font-bold tracking-tight">Marlo</span>
            </div>

            <h1 className="text-2xl font-medium tracking-[-0.04em] sm:text-3xl">Let&apos;s grow your business.</h1>
            <p className="mt-1.5 text-sm leading-snug text-black/60">Get started with your AI CMO.</p>

            <div className="mt-6 flex flex-col gap-3.5">
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-medium text-gray-700">How did you hear about us?</label>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-gray-900"
                >
                  {SOURCE_OPTIONS.map((opt) => (
                    <option key={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-medium text-gray-700">What best describes you?</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-gray-900"
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt}>{opt}</option>
                  ))}
                </select>
              </div>

              <div className="mt-1 flex flex-col gap-1.5">
                <label className="text-[13px] font-medium text-gray-700">Your website</label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleContinue()}
                  placeholder="yourproduct.com"
                  className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm outline-none focus:border-gray-900"
                />
              </div>

              <button
                onClick={handleContinue}
                disabled={saving}
                className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#111111] text-sm font-medium text-white hover:bg-black disabled:opacity-50"
              >
                {saving ? <DotLottieReact src="/ghost-loader.lottie" autoplay loop className="h-4 w-4" /> : null}
                {saving ? "Setting up your site..." : "Get started"}
                {!saving && <ArrowRight className="h-4 w-4" />}
              </button>
            </div>

            <p className="mt-4 text-xs leading-5 text-black/40">
              We&apos;ll crawl your site for real SEO, content, and competitor data — every agent and panel starts
              working from it immediately. You can rename or add more sites later in Settings → Websites.
            </p>
          </div>
        </div>

        {/* Right: brand panel */}
        <div className="relative hidden items-center justify-center overflow-hidden rounded-md bg-[#0b0b0d] lg:flex">
          <div
            className="absolute inset-0"
            style={{
              background: "radial-gradient(120% 120% at 15% 10%, #1f2937 0%, #0b0b0d 55%, #000000 100%)",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-black/20" />

          <div className="relative z-10 flex h-full w-full flex-col justify-between p-8 sm:p-10">
            <div>
              <h2 className="text-2xl font-medium tracking-[-0.03em] text-white sm:text-3xl">
                AI CMO
                <br />
                <span className="italic text-white/60">for growth</span>
              </h2>
              <p className="mt-3 max-w-[420px] text-sm text-white/85">
                The only agent team you need for growth, marketing, and distribution — every channel, one unified
                command.
              </p>
            </div>

            <div>
              <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-white/40">
                {AGENTS.length} agents included
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                {AGENTS.map((agent) => (
                  <div key={agent.name} className="flex items-center gap-2.5 text-sm text-white/90">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ backgroundColor: agent.bg }}
                    >
                      {agent.icon}
                    </span>
                    {agent.name}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
