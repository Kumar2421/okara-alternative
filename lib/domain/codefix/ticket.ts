import crypto from "node:crypto";
import { signPayload, verifyPayload } from "../github/signedPayload.ts";
import { changedPaths, parseClientChanges, type FixChange } from "./catalogFix.ts";
import { FIX_KINDS, type FixKind } from "./fixCatalog.ts";

/**
 * Proposal tickets: a signed, expiring, single-use voucher that binds one previewed fix to the
 * user, project, finding, file list and a SHA-256 of the exact changes. Apply only writes what was
 * previewed; an edited preview must be re-issued (reviseTicket) before it can be applied.
 */

export const TICKET_PURPOSE = "codefix-proposal";
const TICKET_TTL_MS = 30 * 60 * 1000;

/** Where consumed ticket nonces are remembered (existing storage; nothing new to migrate). */
export type TicketClaimPort = {
  /** True when this nonce was not used before (and is now marked used). Must be atomic. */
  claim(nonce: string, expiresAt: number): Promise<boolean>;
  /** Un-marks a nonce, used when the write failed so the user can retry the same preview. */
  release(nonce: string): Promise<void>;
};

export type TicketSubject = { userId: string | null; projectId: string; findingId: string };

/** SHA-256 over the canonical form of the changes (order-independent). */
export function hashChanges(changes: FixChange[]): string {
  const canon = changes
    .map((c) => JSON.stringify(c.type === "edit" ? ["edit", c.path, c.oldSnippet, c.newSnippet] : ["create", c.path, c.content]))
    .sort();
  return crypto.createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}

export function issueTicket(secret: string, subject: TicketSubject, fix: { changes: FixChange[]; kinds: FixKind[]; label: string }, now = Date.now()): string {
  return signPayload(
    secret,
    TICKET_PURPOSE,
    { ...subject, paths: changedPaths(fix.changes), kinds: fix.kinds, label: fix.label, hash: hashChanges(fix.changes) },
    TICKET_TTL_MS,
    now,
  );
}

type VerifiedTicket = { paths: string[]; kinds: FixKind[]; label: string | null; hash: string; nonce: string; exp: number };

function verifyTicket(secret: string, token: unknown, subject: TicketSubject, now: number): VerifiedTicket | null {
  const t = verifyPayload<Record<string, unknown>>(secret, TICKET_PURPOSE, token, now);
  if (!t) return null;
  if (t.userId !== subject.userId || t.projectId !== subject.projectId || t.findingId !== subject.findingId) return null;
  if (!Array.isArray(t.paths) || !Array.isArray(t.kinds) || typeof t.hash !== "string" || typeof t.nonce !== "string") return null;
  return {
    paths: t.paths.filter((p): p is string => typeof p === "string"),
    kinds: t.kinds.filter((k): k is FixKind => (FIX_KINDS as readonly string[]).includes(k as string)),
    label: typeof t.label === "string" ? t.label : null,
    hash: t.hash,
    nonce: t.nonce,
    exp: t.exp,
  };
}

export type Redeemed =
  | { ok: true; changes: FixChange[]; kinds: FixKind[]; label: string | null; release: () => Promise<void> }
  | { ok: false; error: string; status: number };

const EXPIRED = { ok: false as const, error: "This preview expired. Prepare the fix again.", status: 409 };
const USED = { ok: false as const, error: "This preview was already used. Prepare the fix again.", status: 409 };

function parseOrError(rawChanges: unknown, paths: string[]): { changes: FixChange[] } | { error: string } {
  try {
    return { changes: parseClientChanges(rawChanges, paths) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Those changes are not valid." };
  }
}

/** Checks the ticket and that `rawChanges` are exactly what was previewed, then consumes the ticket. */
export async function redeemTicket(
  secret: string,
  token: unknown,
  subject: TicketSubject,
  rawChanges: unknown,
  claims: TicketClaimPort,
  now = Date.now(),
): Promise<Redeemed> {
  const ticket = verifyTicket(secret, token, subject, now);
  if (!ticket) return EXPIRED;
  const parsed = parseOrError(rawChanges, ticket.paths);
  if ("error" in parsed) return { ok: false, error: parsed.error, status: 400 };
  if (hashChanges(parsed.changes) !== ticket.hash) {
    return { ok: false, error: "These changes differ from the preview. Review them again before approving.", status: 409 };
  }
  if (!(await claims.claim(ticket.nonce, ticket.exp))) return USED;
  return { ok: true, changes: parsed.changes, kinds: ticket.kinds, label: ticket.label, release: () => claims.release(ticket.nonce) };
}

/** The user edited the preview: validate against the originally proposed files and sign a fresh ticket for the edit. */
export async function reviseTicket(
  secret: string,
  token: unknown,
  subject: TicketSubject,
  rawChanges: unknown,
  claims: TicketClaimPort,
  now = Date.now(),
): Promise<{ ok: true; ticket: string } | { ok: false; error: string; status: number }> {
  const ticket = verifyTicket(secret, token, subject, now);
  if (!ticket) return EXPIRED;
  const parsed = parseOrError(rawChanges, ticket.paths);
  if ("error" in parsed) return { ok: false, error: parsed.error, status: 400 };
  if (!(await claims.claim(ticket.nonce, ticket.exp))) return USED;
  return { ok: true, ticket: issueTicket(secret, subject, { changes: parsed.changes, kinds: ticket.kinds, label: ticket.label ?? "Fix" }, now) };
}

/** Stable key for proposal tickets from an environment signing secret, or null when none is set. */
export function deriveTicketSecret(env: Record<string, string | undefined>): string | null {
  const raw = [env.GITHUB_APP_CLIENT_SECRET, env.NOTIFY_SIGNING_SECRET].map((v) => v?.trim()).find((v) => v);
  if (!raw) return null;
  return crypto.createHash("sha256").update(`marlo-codefix-ticket:${raw}`).digest("hex");
}
