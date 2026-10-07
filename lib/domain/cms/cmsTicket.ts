import crypto from "node:crypto";
import { signPayload, verifyPayload } from "../github/signedPayload.ts";
import type { TicketClaimPort } from "../codefix/ticket.ts";
import { CmsError, isCmsId, parseClientCmsChanges, type CmsChange, type CmsId, type CmsItemRef } from "./cmsFixCatalog.ts";

/**
 * CMS fix tickets: same properties as the GitHub fix tickets. Signed, expiring (30 min), single
 * use, and bound to the user, project, finding, the exact CMS item AND a SHA-256 of the exact
 * changes. Apply only writes what was previewed; an edited preview is re-issued via revise.
 */

export const CMS_TICKET_PURPOSE = "cms-fix-proposal";
const TICKET_TTL_MS = 30 * 60 * 1000;

export type CmsTicketSubject = { userId: string | null; projectId: string; findingId: string };

export function hashCmsChanges(changes: readonly CmsChange[]): string {
  const canon = changes.map((c) => JSON.stringify([c.field, c.target ?? "", c.after])).sort();
  return crypto.createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}

export function issueCmsTicket(
  secret: string,
  subject: CmsTicketSubject,
  fix: { item: CmsItemRef; changes: readonly CmsChange[]; label: string },
  now = Date.now(),
): string {
  return signPayload(secret, CMS_TICKET_PURPOSE, { ...subject, item: fix.item, label: fix.label, hash: hashCmsChanges(fix.changes) }, TICKET_TTL_MS, now);
}

type Verified = { item: CmsItemRef; label: string; hash: string; nonce: string; exp: number };

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
  return { item, label: typeof t.label === "string" ? t.label : "Fix", hash: t.hash, nonce: t.nonce, exp: t.exp };
}

const EXPIRED = { ok: false as const, error: "This preview expired. Prepare the fix again.", status: 409 };
const USED = { ok: false as const, error: "This preview was already used. Prepare the fix again.", status: 409 };

export type CmsRedeemed =
  | { ok: true; item: CmsItemRef; changes: CmsChange[]; label: string; release: () => Promise<void> }
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
  return { ok: true, item: ticket.item, changes: parsed.changes, label: ticket.label, release: () => claims.release(ticket.nonce) };
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
  if (!(await claims.claim(ticket.nonce, ticket.exp))) return USED;
  return { ok: true, ticket: issueCmsTicket(secret, subject, { item: ticket.item, changes: parsed.changes, label: ticket.label }, now) };
}
