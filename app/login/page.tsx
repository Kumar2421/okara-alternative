"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, Loader2, CheckCircle2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { FEATURES } from "@/lib/features";

// Production-only: signing in with Google also grants GA4 + Search Console
// read scopes up front, so "Connect Google Services" in the dashboard is
// just "already connected" instead of a second OAuth dance. Self-host mode
// keeps the separate manual-client-id flow in Settings → API Credentials.
const GOOGLE_SCOPES =
  "https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly";

type Mode = "signin" | "signup";

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z" fill="#34A853" />
      <path d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84Z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" fill="#EB4335" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.05 12.54c-.03-3.02 2.47-4.47 2.58-4.54-1.41-2.06-3.6-2.34-4.38-2.37-1.86-.19-3.64 1.1-4.58 1.1-.95 0-2.42-1.07-3.98-1.04-2.05.03-3.94 1.19-4.99 3.02-2.13 3.69-.54 9.16 1.53 12.15 1.01 1.46 2.22 3.1 3.81 3.04 1.53-.06 2.11-.99 3.96-.99s2.37.99 3.99.96c1.65-.03 2.69-1.49 3.69-2.96 1.16-1.69 1.64-3.33 1.66-3.41-.04-.02-3.2-1.23-3.24-4.87ZM14.03 3.66c.84-1.02 1.41-2.43 1.25-3.84-1.21.05-2.68.81-3.55 1.83-.78.9-1.46 2.34-1.28 3.72 1.35.1 2.73-.69 3.58-1.71Z" />
    </svg>
  );
}

function MarloMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden="true">
      <circle cx="14" cy="14" r="13" fill="#111111" />
      <circle cx="18.5" cy="9.5" r="7" fill="#ffffff" fillOpacity="0.95" />
      <circle cx="18.5" cy="9.5" r="3.2" fill="#111111" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isSignUp = mode === "signup";

  const toggleMode = () => {
    setMode(isSignUp ? "signin" : "signup");
    setError(null);
    setNotice(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setNotice(null);

    if (isSignUp) {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) {
        setError(authError.message);
      } else if (!data.session) {
        setNotice("Check your email to confirm your account, then sign in.");
        setMode("signin");
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } else {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError(authError.message);
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    }

    setIsLoading(false);
  };

  // Enable once Google/Apple are turned on in the Supabase project's Auth
  // provider settings — this route alone doesn't grant that. Google is
  // wired for production (FEATURES.PLATFORM_MODE); flip
  // NEXT_PUBLIC_GOOGLE_AUTH_ENABLED once the Supabase provider is live.
  const oauthAvailable = {
    google: FEATURES.PLATFORM_MODE && process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true",
    apple: false,
  };

  const handleOAuth = async (provider: "google" | "apple") => {
    setError(null);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
        ...(provider === "google" && FEATURES.PLATFORM_MODE
          ? { scopes: GOOGLE_SCOPES, queryParams: { access_type: "offline", prompt: "consent" } }
          : {}),
      },
    });
  };

  return (
    <section className="h-screen overflow-hidden bg-white p-3 text-black antialiased">
      <div className="grid h-[calc(100vh-1.5rem)] gap-6 lg:grid-cols-[0.94fr_1.06fr]">
        {/* Left: sign-in / sign-up form */}
        <div className="flex items-center justify-center overflow-hidden rounded-md border border-black/10 bg-white px-6 sm:px-10 lg:px-14 xl:px-16">
          <div className="w-full max-w-[420px]">
            <div className="mb-2 flex items-center gap-2">
              <MarloMark className="h-[24px] w-[24px]" />
              <span className="text-sm font-bold tracking-tight">Marlo</span>
            </div>

            <h1 className="text-2xl font-medium tracking-[-0.04em] sm:text-3xl">
              {isSignUp ? "Create your account" : "Welcome back"}
            </h1>
            <p className="mt-1.5 text-sm leading-snug text-black/60">
              Your AI CMO — SEO, leads, and outreach on autopilot.
            </p>

            <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => handleOAuth("google")}
                disabled={!oauthAvailable.google}
                title={oauthAvailable.google ? undefined : "Enable Google in Supabase Auth settings"}
                className="flex h-9 items-center justify-center gap-2 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
              >
                <GoogleIcon />
                Google
              </button>
              <button
                type="button"
                onClick={() => handleOAuth("apple")}
                disabled={!oauthAvailable.apple}
                title="Coming soon"
                className="flex h-9 items-center justify-center gap-2 rounded-lg border border-gray-200 text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
              >
                <AppleIcon />
                Apple
              </button>
            </div>

            <div className="my-4 flex items-center gap-3 text-xs text-black/40">
              <div className="h-px flex-1 bg-black/10" />
              or
              <div className="h-px flex-1 bg-black/10" />
            </div>

            <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="email" className="text-[13px] font-medium text-gray-700">
                  Email
                </label>
                <div className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 focus-within:border-gray-900">
                  <Mail className="h-4 w-4 shrink-0 text-gray-400" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="h-full w-full text-sm outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="password" className="text-[13px] font-medium text-gray-700">
                  Password
                </label>
                <div className="flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 focus-within:border-gray-900">
                  <Lock className="h-4 w-4 shrink-0 text-gray-400" />
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={isSignUp ? "Create a password" : "Enter your password"}
                    required
                    className="h-full w-full text-sm outline-none"
                  />
                </div>
              </div>

              {error && <div className="text-sm text-red-600">{error}</div>}
              {notice && <div className="text-sm text-green-600">{notice}</div>}

              {isSignUp ? (
                <p className="text-xs leading-5 text-black/40">
                  By creating an account, you agree to our{" "}
                  <a href="/terms" className="font-medium underline underline-offset-2">
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a href="/privacy" className="font-medium underline underline-offset-2">
                    Privacy Policy
                  </a>
                </p>
              ) : (
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm font-normal text-black/60">
                    <input type="checkbox" className="h-4 w-4 rounded border-gray-300" />
                    Remember me
                  </label>
                  <button type="button" className="text-sm font-medium text-gray-900 hover:underline">
                    Forgot password?
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="mt-1 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#111111] text-sm font-medium text-white hover:bg-black disabled:opacity-50"
              >
                {isLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                {isLoading ? "Loading..." : isSignUp ? "Create Account" : "Sign In"}
              </button>
            </form>

            <p className="mt-4 text-center text-sm text-black/50">
              {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
              <button type="button" onClick={toggleMode} className="font-medium text-gray-900 hover:underline">
                {isSignUp ? "Sign In" : "Sign Up"}
              </button>
            </p>
          </div>
        </div>

        {/* Right: brand panel */}
        <div className="relative hidden items-center justify-center overflow-hidden rounded-md bg-[#0b0b0d] lg:flex">
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 120% at 15% 10%, #1f2937 0%, #0b0b0d 55%, #000000 100%)",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-black/20" />

          <div className="relative z-10 flex h-full w-full flex-col justify-between p-8 sm:p-10">
            <div />
            <div>
              <h2 className="max-w-[520px] text-3xl font-medium tracking-[-0.03em] text-white sm:text-4xl lg:text-[44px] lg:leading-[1.08]">
                Grow faster,
                <br />
                automatically.
              </h2>
              <p className="mt-3 max-w-[420px] text-sm text-white/85">
                SEO audits, competitor tracking, and lead outreach — run by AI agents
                connected to your own accounts.
              </p>
              <div className="mt-5 flex items-center gap-2 text-sm text-white/85">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                Bring your own LLM key. Your data stays in your project.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
