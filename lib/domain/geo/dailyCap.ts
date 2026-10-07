export const DEFAULT_HOSTED_GEMINI_DAILY_CAP = 20;

/**
 * Per-user daily cap on real Gemini calls. Hosted: env GEMINI_DAILY_CAP or 20.
 * Self-host (user's own key): uncapped (null).
 */
export function resolveGeminiDailyCap(hosted: boolean, envValue: string | undefined): number | null {
  if (!hosted) return null;
  const n = Number(envValue);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_HOSTED_GEMINI_DAILY_CAP;
}

/** Calls left today; null = unlimited. */
export function remainingRuns(cap: number | null, usedToday: number): number | null {
  return cap === null ? null : Math.max(0, cap - usedToday);
}
