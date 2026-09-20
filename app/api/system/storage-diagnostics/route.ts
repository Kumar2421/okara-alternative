import { NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function hasSupabaseConfig(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export async function GET() {
  const configured = hasSupabaseConfig();
  const response = {
    storageMode: FEATURES.PLATFORM_MODE ? "supabase" : "sqlite",
    selfHost: FEATURES.SELF_HOST,
    supabase: {
      configured,
      authenticated: false,
      reachable: false,
    },
    sqlite: {
      available: false,
      checked: false,
    },
    environment: {
      supabaseUrl: configured,
      supabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      supabaseServiceRoleKey: Boolean(process.env.SUPABASE_SECRET_KEY),
    },
  };

  if (configured) {
    try {
      const supabase = await createClient();
      const { data: userData, error: userError } = await supabase.auth.getUser();
      response.supabase.authenticated = !userError && Boolean(userData.user);

      const { error: connectivityError } = await supabase
        .from("projects")
        .select("id")
        .limit(1);
      response.supabase.reachable = !connectivityError;
    } catch {
      response.supabase.reachable = false;
    }
  }

  if (!FEATURES.PLATFORM_MODE) {
    response.sqlite.checked = true;
    try {
      const { getDb } = await import("@/lib/db");
      getDb().prepare("SELECT 1").get();
      response.sqlite.available = true;
    } catch {
      response.sqlite.available = false;
    }
  }

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store" },
  });
}
