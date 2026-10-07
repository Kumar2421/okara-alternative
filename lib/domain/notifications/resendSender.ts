import type { EmailMessage, EmailSender, SendResult } from "./ports.ts";

const RESEND_URL = "https://api.resend.com/emails";

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * Resend REST adapter (POST /emails). The API key goes only in the
 * Authorization header; it is never put in an error message or log.
 * `Idempotency-Key` makes a retried request safe for 24 hours.
 */
export function resendSender(config: { apiKey: string; from: string; fetch?: FetchLike; timeoutMs?: number }): EmailSender {
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));
  return {
    async send(message: EmailMessage): Promise<SendResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);
      try {
        const response = await doFetch(RESEND_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": message.idempotencyKey.slice(0, 256),
          },
          body: JSON.stringify({
            from: config.from,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
            headers: message.headers,
          }),
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => null)) as { id?: unknown; message?: unknown } | null;
        if (response.ok && typeof body?.id === "string") return { ok: true, id: body.id };
        const detail = typeof body?.message === "string" ? body.message.slice(0, 200) : "no details";
        // A bad key (401/403) or an unverified sending domain (422) is our setup, not this message.
        const configError =
          response.status === 401 || response.status === 403 ||
          (response.status === 422 && /domain|verif/i.test(typeof body?.message === "string" ? body.message : ""));
        return {
          ok: false,
          configError,
          error: `Resend responded ${response.status}: ${detail}`,
          // Rate limits and provider errors are worth retrying; a rejected message or bad key is not.
          retryable: configError || response.status === 429 || response.status === 409 || response.status >= 500,
        };
      } catch {
        return { ok: false, error: "Could not reach Resend.", retryable: true };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
