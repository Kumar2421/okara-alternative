"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, Loader2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

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

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
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
      const { data, error: authError } = await supabase.auth.signUp({ email, password });
      if (authError) {
        setError(authError.message);
      } else if (!data.session) {
        setNotice("Check your email to confirm your account, then sign in.");
        setMode("signin");
      } else {
        router.push("/");
        router.refresh();
      }
    } else {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError(authError.message);
      } else {
        router.push("/");
        router.refresh();
      }
    }

    setIsLoading(false);
  };

  // Enable once Google OAuth is configured in Settings → LLM Providers →
  // Supabase project's Auth providers.
  const oauthAvailable = false;

  const handleOAuth = async () => {
    setError(null);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/api/auth/callback` },
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-[400px]">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-[#111111] text-[13px] font-bold text-white">
            O
          </div>
          <h1 className="text-[20px] font-semibold text-gray-900">
            {isSignUp ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1 text-[13px] text-gray-500">Okara — AI CMO dashboard</p>
        </div>

        <button
          type="button"
          onClick={handleOAuth}
          disabled={!oauthAvailable}
          title={oauthAvailable ? undefined : "Connect Google in your Supabase project first"}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 py-2 text-[13px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="mb-4 flex items-center gap-3 text-[11px] text-gray-400">
          <div className="h-px flex-1 bg-gray-200" />
          or
          <div className="h-px flex-1 bg-gray-200" />
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-[12px] font-medium text-gray-700">
              Email
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 focus-within:border-gray-900">
              <Mail size={14} className="shrink-0 text-gray-400" />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full text-[13px] outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-[12px] font-medium text-gray-700">
              Password
            </label>
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 focus-within:border-gray-900">
              <Lock size={14} className="shrink-0 text-gray-400" />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignUp ? "Create a password" : "Enter your password"}
                required
                className="w-full text-[13px] outline-none"
              />
            </div>
          </div>

          {error && <div className="text-[12px] text-red-600">{error}</div>}
          {notice && <div className="text-[12px] text-green-600">{notice}</div>}

          {isSignUp && (
            <p className="text-[11px] leading-5 text-gray-400">
              By creating an account, you agree to our Terms of Service and Privacy Policy.
            </p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-[#111111] py-2 text-[13px] font-medium text-white hover:bg-black disabled:opacity-50"
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : null}
            {isLoading ? "Loading..." : isSignUp ? "Create Account" : "Sign In"}
          </button>
        </form>

        <p className="mt-4 text-center text-[13px] text-gray-500">
          {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
          <button type="button" onClick={toggleMode} className="font-medium text-gray-900 hover:underline">
            {isSignUp ? "Sign In" : "Sign Up"}
          </button>
        </p>
      </div>
    </div>
  );
}
