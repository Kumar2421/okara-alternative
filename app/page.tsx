import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

function OkaraMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <circle cx="14" cy="14" r="13" fill="#111111" />
      <circle cx="18.5" cy="9.5" r="7" fill="#ffffff" fillOpacity="0.95" />
      <circle cx="18.5" cy="9.5" r="3.2" fill="#111111" />
    </svg>
  );
}

const FEATURES = [
  "SEO audits & crawling",
  "Competitor tracking",
  "AI-powered lead generation",
  "Automated email outreach",
  "GitHub code fixes for SEO issues",
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4 sm:px-10">
        <div className="flex items-center gap-2">
          <OkaraMark className="h-6 w-6" />
          <span className="text-[15px] font-bold tracking-tight">Okara</span>
        </div>
        <Link
          href="/login"
          className="rounded-lg bg-[#111111] px-4 py-2 text-[13px] font-medium text-white hover:bg-black"
        >
          Sign In
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-16 sm:px-10">
        <div className="grid w-full max-w-5xl items-center gap-12 lg:grid-cols-2">
          <div>
            <h1 className="text-4xl font-medium tracking-[-0.03em] text-gray-900 sm:text-5xl">
              Your AI CMO,
              <br />
              running 24/7.
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-gray-600">
              Okara audits your SEO, tracks competitors, finds leads, and sends
              outreach — all through agents connected to your own accounts and
              your own LLM keys.
            </p>

            <div className="mt-8 flex items-center gap-3">
              <Link
                href="/login"
                className="rounded-lg bg-[#111111] px-5 py-2.5 text-[14px] font-medium text-white hover:bg-black"
              >
                Get Started
              </Link>
              <Link
                href="/login"
                className="rounded-lg border border-gray-200 px-5 py-2.5 text-[14px] font-medium text-gray-700 hover:bg-gray-50"
              >
                Sign In
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50 p-6">
            <p className="mb-4 text-[13px] font-semibold text-gray-500">What Okara does</p>
            <ul className="space-y-3">
              {FEATURES.map((feature) => (
                <li key={feature} className="flex items-center gap-2.5 text-[14px] text-gray-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-100 px-6 py-6 text-center text-[12px] text-gray-400 sm:px-10">
        Open source — self-host it, or bring your own keys.
      </footer>
    </div>
  );
}
