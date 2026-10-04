/**
 * Provider model ids get retired. A hard-coded id that no longer exists
 * answers 404 ("The model `x` does not exist or you do not have access to
 * it") and used to take the whole feature down with it. These helpers let a
 * driver notice that specific failure and try the provider's other models.
 */

/** True for the "this model id is gone / not yours" failure, across SDK error shapes. */
export function isModelNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: unknown; code?: unknown; message?: unknown; error?: { code?: unknown } };
  if (e.code === "model_not_found" || e.error?.code === "model_not_found") return true;
  const message = typeof e.message === "string" ? e.message : "";
  if (/model.*(does not exist|not found|decommissioned|no longer supported)/i.test(message)) return true;
  return e.status === 404 && /model/i.test(message);
}

/** The requested model first, then the rest of the provider's models, each at most once. */
export function modelAttempts(requested: string, alternatives: readonly string[]): string[] {
  return [requested, ...alternatives.filter((m) => m !== requested)];
}
