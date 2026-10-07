/**
 * Pure functions for detecting specific error conditions in draft generation.
 */

/** Detect if error is the "no subreddit" error from Reddit generation. */
export function isNoSubredditError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes("Specify a subreddit or configure one in Settings");
  }
  return false;
}

/** Clamp variants to valid range: 1-3. */
export function clampVariants(v?: number): number {
  return Math.min(3, Math.max(1, Math.floor(v ?? 3)));
}
