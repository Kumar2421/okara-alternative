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
  const hasPublicSupabaseConfig = Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const platformMode =
    env.NEXT_PUBLIC_PLATFORM_MODE === "true" ||
    (env.NEXT_PUBLIC_SELF_HOST !== "true" && hasPublicSupabaseConfig);
  const missing = platformMode
    ? PLATFORM_ENV_KEYS.filter((key) => !env[key])
    : [];

  return {
    platformMode,
    missing,
  };
}
