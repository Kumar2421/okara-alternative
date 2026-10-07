import crypto from "node:crypto";
import { signPayload, verifyPayload } from "../github/signedPayload.ts";
import type { TicketClaimPort } from "../codefix/ticket.ts";
import { CmsError, changeKey, isCmsId, parseClientCmsChanges, type CmsChange, type CmsId, type CmsItemRef } from "./cmsFixCatalog.ts";

/**
 * CMS fix tickets: same properties as the GitHub fix tickets. Signed, expiring (30 min), single
 * use, and bound to the user, project, finding, the exact CMS item AND a SHA-256 of the exact
 * changes. Apply only writes what was previewed; an edited preview is re-issued via revise, which may
 * only keep a subset of the previewed (field, target) slots. The ticket also carries a digest of the
 * page's live BEFORE value for each slot, so apply can refuse when the page changed after the preview.
 */

export const CMS_TICKET_PURPOSE = "cms-fix-proposal";
const TICKET_TTL_MS = 30 * 60 * 1000;

export type CmsTicketSubject = { userId: string | null; projectId: string; findingId: string };

export function hashCmsChanges(changes: readonly CmsChange[]): string {
  const canon = changes.map((c) => JSON.stringify([c.field, c.target ?? "", c.after])).sort();
  return crypto.createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}

const digest = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

/** slot key -> SHA-256 of the live before value. */
export function beforeDigests(values: readonly { field: string; target?: string; before: string }[]): Record<string, string> {
  return Object.fromEntries(values.map((v) => [changeKey(v), digest(v.before)]));
}

/** True when the page still holds, for every change slot, exactly the value that was previewed. */
export function liveBeforeMatches(
  befores: Record<string, string>,
  changes: readonly CmsChange[],
  live: readonly { field: string; target?: string; before: string }[],
): boolean {
  const now = beforeDigests(live);
  return changes.every((c) => {
    const k = changeKey(c);
    return typeof befores[k] === "string" && befores[k] === now[k];
  });
}

export function issueCmsTicket(
  secret: string,
  subject: CmsTicketSubject,
  fix: { item: CmsItemRef; changes: readonly CmsChange[]; label: string; allowed?: readonly string[]; befores?: Record<string, string> },
  now = Date.now(),
): string {
  const allowed = fix.allowed ?? fix.changes.map(changeKey);
  const befores = fix.befores ?? beforeDigests(fix.changes);
  return signPayload(secret, CMS_TICKET_PURPOSE, { ...subject, item: fix.item, label: fix.label, hash: hashCmsChanges(fix.changes), allowed, befores }, TICKET_TTL_MS, now);
}

type Verified = { item: CmsItemRef; label: string; hash: string; nonce: string; exp: number; allowed: string[]; befores: Record<string, string> };

function asItem(v: unknown): CmsItemRef | null {
  const i = v as Partial<CmsItemRef> | null;
  if (!i || !isCmsId(i.cms) || typeof i.id !== "string" || typeof i.kind !== "string" || typeof i.url !== "string") return null;
  return {
    cms: i.cms,
    id: i.id,
    kind: i.kind,
    title: typeof i.title === "string" ? i.title : "",
    slug: typeof i.slug === "string" ? i.slug : "",
    url: i.url,
    ...(typeof i.collectionId === "string" ? { collectionId: i.collectionId } : {}),
  };
}

function verifyCmsTicket(secret: string, token: unknown, subject: CmsTicketSubject, now: number): Verified | null {
  const t = verifyPayload<Record<string, unknown>>(secret, CMS_TICKET_PURPOSE, token, now);
  if (!t) return null;
  if (t.userId !== subject.userId || t.projectId !== subject.projectId || t.findingId !== subject.findingId) return null;
  const item = asItem(t.item);
  if (!item || typeof t.hash !== "string" || typeof t.nonce !== "string") return null;
  if (!Array.isArray(t.allowed) || !t.allowed.every((k) => typeof k === "string")) return null;
  const b = t.befores as Record<string, unknown> | null;
  if (!b || typeof b !== "object" || Object.values(b).some((v) => typeof v !== "string")) return null;
  return { item, label: typeof t.label === "string" ? t.label : "Fix", hash: t.hash, nonce: t.nonce, exp: t.exp, allowed: t.allowed as string[], befores: b as Record<string, string> };
}

const EXPIRED = { ok: false as const, error: "This preview expired. Prepare the fix again.", status: 409 };
const USED = { ok: false as const, error: "This preview was already used. Prepare the fix again.", status: 409 };

export type CmsRedeemed =
  | { ok: true; item: CmsItemRef; changes: CmsChange[]; label: string; befores: Record<string, string>; release: () => Promise<void> }
  | { ok: false; error: string; status: number };

function parse(raw: unknown, cms: CmsId, pageUrl: string | null): { changes: CmsChange[] } | { error: string } {
  try {
    return { changes: parseClientCmsChanges(raw, { cms, pageUrl }) };
  } catch (err) {
    return { error: err instanceof CmsError ? err.message : "Those changes are not valid." };
  }
}

/** Checks the ticket and that `rawChanges` are exactly what was previewed, then consumes the ticket. */
export async function redeemCmsTicket(
  secret: string,
  token: unknown,
  subject: CmsTicketSubject,
  rawChanges: unknown,
  claims: TicketClaimPort,
  now = Date.now(),
): Promise<CmsRedeemed> {
  const ticket = verifyCmsTicket(secret, token, subject, now);
  if (!ticket) return EXPIRED;
  const parsed = parse(rawChanges, ticket.item.cms, ticket.item.url);
  if ("error" in parsed) return { ok: false, error: parsed.error, status: 400 };
  if (hashCmsChanges(parsed.changes) !== ticket.hash) {
    return { ok: false, error: "These changes differ from the preview. Review them again before approving.", status: 409 };
  }
  if (!(await claims.claim(ticket.nonce, ticket.exp))) return USED;
  return { ok: true, item: ticket.item, changes: parsed.changes, label: ticket.label, befores: ticket.befores, release: () => claims.release(ticket.nonce) };
}

/** The user edited the preview: validate, consume the old ticket, sign a fresh one for the edit. */
export async function reviseCmsTicket(
  secret: string,
  token: unknown,
  subject: CmsTicketSubject,
  rawChanges: unknown,
  claims: TicketClaimPort,
  now = Date.now(),
): Promise<{ ok: true; ticket: string } | { ok: false; error: string; status: number }> {
  const ticket = verifyCmsTicket(secret, token, subject, now);
  if (!ticket) return EXPIRED;
  const parsed = parse(rawChanges, ticket.item.cms, ticket.item.url);
  if ("error" in parsed) return { ok: false, error: parsed.error, status: 400 };
  // Edits may only narrow or reword what was previewed, never add a slot that was not previewed.
  if (!parsed.changes.every((c) => ticket.allowed.includes(changeKey(c)))) {
    return { ok: false, error: "You can only edit the changes that were previewed. Prepare the fix again to change more.", status: 400 };
  }
  if (!(await claims.claim(ticket.nonce, ticket.exp))) return USED;
  return {
    ok: true,
    ticket: issueCmsTicket(secret, subject, { item: ticket.item, changes: parsed.changes, label: ticket.label, allowed: ticket.allowed, befores: ticket.befores }, now),
  };
}
