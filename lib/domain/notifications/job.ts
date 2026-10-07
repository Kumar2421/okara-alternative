import { runWithBudget } from "../../jobs/jobRunner.ts";
import {
  approvalsKey, creditsKey, creditsThreshold, dailyDigestKey, digestKey, integrationKey, isBigWin, outcomeKey, withinEmailCap,
} from "./caps.ts";
import { buildDigest, type Digest, type ProjectActivity, type SnapshotLike } from "./digest.ts";
import { emailDecision, inAppEnabled, localParts, type NotificationPrefs } from "./preferences.ts";
import type { EmailSender, NotificationStore } from "./ports.ts";
import { renderDigestEmail, renderNotificationEmail, type EmailLinks, type RenderedEmail } from "./render.ts";
import { categoryOf, type Notification, type NotificationDraft } from "./types.ts";

const DAY_MS = 86_400_000;
/** Outcomes saved longer ago than this are history, not news (stops a first deploy from announcing old results). */
const FRESH_OUTCOME_DAYS = 8;
/** Emails that could not be sent (and are worth retrying) are retried for this long. */
const RETRY_WINDOW_DAYS = 3;
const MAX_EMAILS_PER_USER_RUN = 5;

export type MeasuredOutcome = {
  actionId: string;
  actionTitle: string;
  status: "improved" | "unchanged" | "regressed" | string;
  confidence: "early" | "solid" | null;
  headline: string;
  /** When the verdict became final. */
  evaluatedAt: string;
};

export type ProjectFacts = {
  projectId: string;
  projectName: string;
  measured: MeasuredOutcome[];
  /** Changes marked as made, with when. */
  fixesMade: Array<{ title: string; implementedAt: string }>;
  latest: SnapshotLike | null;
  weekAgo: SnapshotLike | null;
  /** Fixes with an open pull request waiting for the user to review. */
  approvalsWaiting: number;
};

export type UserFacts = {
  /** Where emails go. Null: in-app only. */
  email: string | null;
  projects: ProjectFacts[];
  /** Null in self-host (nothing is metered). `billingEnabled` false (beta) means no warnings. */
  credits: { balance: number; granted: number; billingEnabled: boolean } | null;
  integrations: Array<{ id: string; label: string; disconnected: boolean }>;
};

export type UserRef = { userId: string };

/** Where the job learns about users. Platform reads Supabase; self-host reads the local database. */
export interface NotificationSource {
  listUsers(): Promise<UserRef[]>;
  loadFacts(userId: string, now: Date): Promise<UserFacts>;
}

export type NotificationJobDeps = {
  source: NotificationSource;
  store: NotificationStore;
  /** Null when email is not configured: everything stays in-app. */
  sender: EmailSender | null;
  /** Null when links cannot be signed (no secret / no app URL): no non-transactional email is sent. */
  linksFor: (userId: string) => EmailLinks | null;
  now?: Date;
  budgetMs: number;
  log?: (message: string) => void;
};

export type NotificationJobSummary = {
  users: number;
  skipped: number;
  created: number;
  emailed: number;
  emailFailed: number;
  failed: Array<{ error: string }>;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Which drafts the facts call for. Pure; storage dedupe makes repeats harmless. */
export function draftsFor(args: { facts: UserFacts; prefs: NotificationPrefs; now: Date }): { drafts: NotificationDraft[]; digest: Digest | null; digestDraft: NotificationDraft | null } {
  const { facts, prefs, now } = args;
  const local = localParts(now, prefs.timezone);
  const drafts: NotificationDraft[] = [];

  // Fixes that just got a final verdict.
  const instantOutcomeIds = new Set<string>();
  for (const project of facts.projects) {
    for (const m of project.measured) {
      if (m.status !== "improved" && m.status !== "unchanged" && m.status !== "regressed") continue;
      if (m.confidence !== "solid" || now.getTime() - Date.parse(m.evaluatedAt) > FRESH_OUTCOME_DAYS * DAY_MS) continue;
      const bigWin = isBigWin(m);
      // Only one big win a day gets its own email; the rest wait for the digest.
      if (bigWin && prefs.categories.outcomes === "instant" && instantOutcomeIds.size === 0) instantOutcomeIds.add(m.actionId);
      drafts.push({
        kind: "outcome_measured",
        projectId: project.projectId,
        dedupeKey: outcomeKey(m.actionId),
        title: bigWin ? `A fix looks like it worked: ${m.actionTitle}` : `A fix was measured: ${m.actionTitle}`,
        body: m.headline,
        payload: { actionId: m.actionId, status: m.status, bigWin },
      });
    }
  }

  if (facts.credits?.billingEnabled) {
    const threshold = creditsThreshold(facts.credits.balance, facts.credits.granted);
    if (threshold !== null) {
      drafts.push({
        kind: "credits_low",
        projectId: null,
        dedupeKey: creditsKey(threshold, now),
        title: threshold === 0 ? "You are out of credits" : "Your credits are running low",
        body: threshold === 0 ? "Agents that use credits are paused until you add more." : `You have ${facts.credits.balance} credits left, about a fifth of what you started with.`,
        payload: { threshold, balance: facts.credits.balance },
      });
    }
  }

  const waiting = facts.projects.reduce((n, p) => n + p.approvalsWaiting, 0);
  if (waiting > 0) {
    drafts.push({
      kind: "approval_needed",
      projectId: null,
      dedupeKey: approvalsKey(local.isoDate),
      title: `${plural(waiting, "fix is", "fixes are")} waiting for your review`,
      body: "Open the pull request to review and merge it. Nothing changes on your site until you do.",
      payload: { waiting },
    });
  }

  for (const integration of facts.integrations) {
    if (!integration.disconnected) continue;
    drafts.push({
      kind: "integration_disconnected",
      projectId: null,
      dedupeKey: integrationKey(integration.id, now),
      title: `${integration.label} needs to be reconnected`,
      body: `Marlo lost access to ${integration.label}, so related data may go stale until you reconnect it in Settings.`,
      payload: { integration: integration.id },
    });
  }

  // The digest, on the user's own Monday (weekly) or every day (daily).
  let digest: Digest | null = null;
  let digestDraft: NotificationDraft | null = null;
  const cadence = prefs.categories.digest;
  if (cadence === "weekly" || cadence === "daily" || cadence === "instant") {
    const weekly = cadence !== "daily";
    if (!weekly || local.weekday === 1) {
      const windowMs = (weekly ? 7 : 1) * DAY_MS;
      const since = now.getTime() - windowMs;
      const activity: ProjectActivity[] = facts.projects.map((p) => ({
        projectId: p.projectId,
        projectName: p.projectName,
        newOutcomes: p.measured
          .filter((m) => (m.status === "improved" || m.status === "unchanged" || m.status === "regressed") && m.confidence === "solid")
          .filter((m) => Date.parse(m.evaluatedAt) >= since && !instantOutcomeIds.has(m.actionId))
          .map((m) => ({ actionTitle: m.actionTitle, status: m.status as "improved" | "unchanged" | "regressed", confidence: m.confidence, headline: m.headline })),
        fixesMade: p.fixesMade.filter((f) => Date.parse(f.implementedAt) >= since),
        latest: weekly ? p.latest : null,
        weekAgo: weekly ? p.weekAgo : null,
        approvalsWaiting: p.approvalsWaiting,
      }));
      digest = buildDigest(activity);
      if (digest) {
        digestDraft = {
          kind: "weekly_digest",
          projectId: null,
          dedupeKey: weekly ? digestKey(local.isoDate) : dailyDigestKey(local.isoDate),
          title: weekly ? "Your week in Marlo" : "Your day in Marlo",
          body: digest.summary,
          payload: { digest },
        };
      }
    }
  }
  return { drafts, digest, digestDraft };
}

async function processUser(userId: string, deps: NotificationJobDeps, now: Date, tally: NotificationJobSummary): Promise<void> {
  const { store } = deps;
  const stored = await store.getPreferences(userId);
  const { prefs } = stored;
  const facts = await deps.source.loadFacts(userId, now);

  const planned = draftsFor({ facts, prefs, now });
  const all = planned.digestDraft ? [...planned.drafts, planned.digestDraft] : planned.drafts;
  for (const draft of all) {
    if (!inAppEnabled(prefs, categoryOf(draft.kind))) continue;
    const result = await store.record(userId, draft, now);
    if (result.created) tally.created += 1;
  }

  await flushEmails(userId, facts.email, stored, deps, now, tally);
}

function renderFor(n: Notification, links: EmailLinks): RenderedEmail {
  const digest = n.kind === "weekly_digest" ? (n.payload.digest as Digest | undefined) : undefined;
  return digest ? renderDigestEmail(digest, links) : renderNotificationEmail(n, links);
}

async function flushEmails(
  userId: string,
  to: string | null,
  stored: { prefs: NotificationPrefs; unsubscribedAll: boolean },
  deps: NotificationJobDeps,
  now: Date,
  tally: NotificationJobSummary,
): Promise<void> {
  const links = deps.linksFor(userId);
  if (!deps.sender || !to || !links) return;

  const pending = await deps.store.listEmailPending(userId, new Date(now.getTime() - RETRY_WINDOW_DAYS * DAY_MS).toISOString());
  const sentThisRun = new Map<string, number>();
  let budget = MAX_EMAILS_PER_USER_RUN;

  for (const n of pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (budget <= 0) break;
    if (emailDecision(n, stored, now) !== "send") continue;

    const recent = await deps.store.countEmailedSince(userId, n.kind, new Date(now.getTime() - DAY_MS).toISOString());
    if (!withinEmailCap(n.kind, recent + (sentThisRun.get(n.kind) ?? 0))) continue;

    const email = renderFor(n, links);
    const result = await deps.sender.send({ to, ...email, idempotencyKey: `marlo-notification-${n.id}` });
    if (result.ok) {
      await deps.store.markEmailed(userId, n.id, now, null);
      sentThisRun.set(n.kind, (sentThisRun.get(n.kind) ?? 0) + 1);
      tally.emailed += 1;
      budget -= 1;
    } else {
      tally.emailFailed += 1;
      deps.log?.(`notification email failed (${n.kind}): ${result.error}`);
      if (!result.retryable) await deps.store.markEmailed(userId, n.id, now, result.error.slice(0, 300));
    }
  }
}

/**
 * The daily notification pass: detect, store (idempotent by dedupe key), then
 * email what the user's preferences allow. One user failing never stops the
 * others; the time budget stops cleanly and the rest resume next run.
 */
export async function runNotificationJob(deps: NotificationJobDeps): Promise<NotificationJobSummary> {
  const now = deps.now ?? new Date();
  const tally: NotificationJobSummary = { users: 0, skipped: 0, created: 0, emailed: 0, emailFailed: 0, failed: [] };
  const users = await deps.source.listUsers();
  const summary = await runWithBudget(users, (u) => processUser(u.userId, deps, now, tally), { budgetMs: deps.budgetMs });
  tally.users = summary.processed;
  tally.skipped = summary.skipped;
  tally.failed = summary.failed.map((f) => ({ error: f.error }));
  for (const f of tally.failed) deps.log?.(`notification job user failed: ${f.error}`);
  return tally;
}
