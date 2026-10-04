/** A failed API call, keeping the HTTP status so callers can tell "not connected" (4xx) from "server broke" (5xx). */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * fetch + JSON with real error handling. Throws ApiError carrying the server's
 * `{ error }` message instead of silently returning nothing, so a failed load
 * is visible to the UI (and to retry logic) rather than looking like "no data".
 */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch {
    throw new ApiError("Network error. Check your connection and try again.", 0);
  }

  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new ApiError(payload?.error ?? `Request failed (${response.status})`, response.status);
  }
  return payload as T;
}
