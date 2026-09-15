"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";

export type AuthUser = {
  name: string;
  initials: string;
  email: string;
};

function deriveDisplay(email: string, fullName?: string | null): { name: string; initials: string } {
  const name = fullName?.trim() || email.split("@")[0];
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "U";
  return { name, initials };
}

/** Reads the signed-in Supabase user for display in the account menu.
 * Returns null while loading or if no Supabase project is configured yet
 * (credentials pending) — callers should fall back to a placeholder. */
export function useAuthUser(): { user: AuthUser | null; loading: boolean } {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      setLoading(false);
      return;
    }

    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        const { name, initials } = deriveDisplay(
          data.user.email ?? "",
          data.user.user_metadata?.full_name
        );
        setUser({ name, initials, email: data.user.email ?? "" });
      }
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const { name, initials } = deriveDisplay(
          session.user.email ?? "",
          session.user.user_metadata?.full_name
        );
        setUser({ name, initials, email: session.user.email ?? "" });
      } else {
        setUser(null);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  return { user, loading };
}
