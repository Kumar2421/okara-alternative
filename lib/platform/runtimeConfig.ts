import { FEATURES } from "@/lib/features";

export const PLATFORM_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
] as const;

type PlatformEnvKey = (typeof PLATFORM_ENV_KEYS)[number];

export type PlatformRuntimeConfig = {
  platformMode: boolean;
  missing: PlatformEnvKey[];
};

export function getPlatformRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): PlatformRuntimeConfig {
  const missing = FEATURES.PLATFORM_MODE
    ? PLATFORM_ENV_KEYS.filter((key) => !env[key])
    : [];

  return {
    platformMode: FEATURES.PLATFORM_MODE,
    missing,
  };
}
