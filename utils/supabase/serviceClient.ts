import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client — bypasses RLS, only for trusted server code (API
 * routes running agent actions, credit metering, connection storage). Never
 * import this in client components or expose SUPABASE_SECRET_KEY to the
 * browser. Platform (SaaS) mode only — self-host has no Supabase project.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SECRET_KEY / NEXT_PUBLIC_SUPABASE_URL not set — platform mode requires both");
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
