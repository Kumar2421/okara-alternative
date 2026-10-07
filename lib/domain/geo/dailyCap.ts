export const DEFAULT_HOSTED_GEMINI_DAILY_CAP = 20;
export const DEFAULT_HOSTED_SIMULATED_DAILY_CAP = 60;

/**
 * Per-user daily cap on real Gemini calls. Hosted: env GEMINI_DAILY_CAP or 20.
 * Self-host (user's own key): uncapped (null).
 */
export function resolveGeminiDailyCap(hosted: boolean, envValue: string | undefined): number | null {
  if (!hosted) return null;
  const n = Number(envValue);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_HOSTED_GEMINI_DAILY_CAP;
}

/**
 * Per-user daily cap on simulated runs (each one is a Tavily search plus a Groq
 * completion on platform keys). Hosted: env SIMULATED_DAILY_CAP or 60.
 * Self-host (own keys): uncapped (null).
 */
export function resolveSimulatedDailyCap(hosted: boolean, envValue: string | undefined): number | null {
  if (!hosted) return null;
  const n = Number(envValue);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_HOSTED_SIMULATED_DAILY_CAP;
}

/** Calls left today; null = unlimited. */
export function remainingRuns(cap: number | null, usedToday: number): number | null {
  return cap === null ? null : Math.max(0, cap - usedToday);
}

/**
 * Runs per prompt that fit under a daily cap for this many prompts: `full`
 * when it fits, fewer (never below 1) when it does not. Null cap = full.
 */
export function runsPerPromptFor(cap: number | null, promptCount: number, full: number): number {
  if (cap === null || promptCount <= 0) return full;
  return Math.max(1, Math.min(full, Math.floor(cap / promptCount)));
}

/** How many prompts get any run today under the cap at `perPrompt` runs each. */
export function promptsThatFit(cap: number | null, promptCount: number, perPrompt: number): number {
  if (cap === null) return promptCount;
  return Math.min(promptCount, Math.floor(cap / perPrompt));
}
