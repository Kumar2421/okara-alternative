export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

// Broader Gmail scopes that also allow sending / reading.
const SENDS = new Set([GMAIL_SEND_SCOPE, "https://www.googleapis.com/auth/gmail.modify", "https://www.googleapis.com/auth/gmail.compose", "https://mail.google.com/"]);
const READS = new Set([GMAIL_READ_SCOPE, "https://www.googleapis.com/auth/gmail.modify", "https://mail.google.com/"]);

export type GmailCapabilities = {
  canSend: boolean;
  canRead: boolean;
  /** False when the granted scopes were never recorded; callers then assume access works and let Google's answer decide. */
  known: boolean;
};

/**
 * What a Gmail connection is allowed to do, from the scopes Google granted.
 * Google's consent screen lets people untick individual permissions, so
 * "connected" alone does not mean "can send" or "can read replies".
 */
export function gmailCapabilities(scopes: readonly string[] | string | null | undefined): GmailCapabilities {
  const list = typeof scopes === "string" ? scopes.split(/\s+/) : [...(scopes ?? [])];
  const granted = list.map((s) => s.trim()).filter(Boolean);
  if (granted.length === 0) return { canSend: true, canRead: true, known: false };
  return {
    canSend: granted.some((s) => SENDS.has(s)),
    canRead: granted.some((s) => READS.has(s)),
    known: true,
  };
}
