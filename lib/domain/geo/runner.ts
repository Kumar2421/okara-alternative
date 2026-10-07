import { analyzeAnswer, dayOf, type Subject } from "./visibility.ts";
import { promptsThatFit, remainingRuns, runsPerPromptFor } from "./dailyCap.ts";
import type { AnswerPort } from "./engines.ts";
import { RUNS_PER_PROMPT, type AnswerMethod, type GeoRunRow } from "./types.ts";

export type RunStore = {
  /** Runs already stored for this prompt + method on this UTC day. */
  countRuns(prompt: string, method: AnswerMethod, date: string): Promise<number>;
  /** Calls used by this user for this method today (failed calls included), for the daily cap. */
  countMethodRunsToday(method: AnswerMethod, date: string): Promise<number>;
  /**
   * Atomically take one call slot against the user's daily cap before the call
   * is made. Returns false (and takes nothing) when the cap is used up.
   */
  reserve(method: AnswerMethod, date: string, cap: number): Promise<boolean>;
  /** Per-project in-flight guard. False when another run holds it. */
  tryLock(ttlMs: number): Promise<boolean>;
  unlock(): Promise<void>;
  saveRuns(rows: GeoRunRow[]): Promise<void>;
};

export type SkipReason = "cap" | "rotation" | "budget";

export type SkippedPrompt = { prompt: string; method: AnswerMethod; reason: SkipReason };

export type RunSummary = {
  ran: number;
  skippedAlreadyDone: number;
  skippedCap: number;
  skippedBudget: number;
  failed: Array<{ prompt: string; method: AnswerMethod; error: string }>;
  /** Which prompts were not (fully) run and why. Rotation = the daily cap is smaller than the prompt list, so the start moves each day. */
  skipped: SkippedPrompt[];
  /** Runs per prompt actually targeted per method (lower than 3 when the daily cap is small). */
  runsPerPrompt: Partial<Record<AnswerMethod, number>>;
  /** True when another run for this project was already in flight and nothing was done. */
  inFlight?: boolean;
};

export function emptySummary(): RunSummary {
  return { ran: 0, skippedAlreadyDone: 0, skippedCap: 0, skippedBudget: 0, failed: [], skipped: [], runsPerPrompt: {} };
}

const EXCERPT_CHARS = 400;
const LOCK_TTL_MS = 120_000;

/** Rotate the list so the starting prompt changes each UTC day. */
export function rotateByDay<T>(items: T[], date: string): T[] {
  if (items.length === 0) return items;
  const dayNumber = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const offset = ((dayNumber % items.length) + items.length) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

/**
 * Run every prompt up to RUNS_PER_PROMPT times per port. Idempotent per UTC
 * day: runs already stored today count, so a retry adds nothing extra.
 *
 * Daily caps (`caps`, method -> max calls per day, null/absent = unlimited):
 * a slot is reserved atomically BEFORE each call, so concurrent runs cannot
 * overshoot, and failed calls still count. When the cap is smaller than
 * prompts x 3, runs per prompt drop (never below 1) and, if even that does not
 * fit, the starting prompt rotates by day; every skipped prompt is reported.
 * A per-project lock stops double clicks and cron overlap from double-running.
 */
export async function runGeoPrompts(args: {
  prompts: string[];
  ports: AnswerPort[];
  subject: Subject;
  store: RunStore;
  caps?: Partial<Record<AnswerMethod, number | null>>;
  now?: () => Date;
  budgetMs?: number;
  clock?: () => number;
}): Promise<RunSummary> {
  const now = args.now ?? (() => new Date());
  const clock = args.clock ?? Date.now;
  const deadline = clock() + (args.budgetMs ?? 45_000);
  const summary = emptySummary();
  const today = dayOf(now().toISOString());

  if (!(await args.store.tryLock(LOCK_TTL_MS))) {
    summary.inFlight = true;
    return summary;
  }
  try {
    for (const port of args.ports) {
      const cap = args.caps?.[port.method] ?? null;
      const perPrompt = runsPerPromptFor(cap, args.prompts.length, RUNS_PER_PROMPT);
      summary.runsPerPrompt[port.method] = perPrompt;
      const fit = promptsThatFit(cap, args.prompts.length, perPrompt);
      const ordered = fit < args.prompts.length ? rotateByDay(args.prompts, today) : args.prompts;
      const startLeft = remainingRuns(cap, await args.store.countMethodRunsToday(port.method, today));

      for (const [index, prompt] of ordered.entries()) {
        if (index >= fit) {
          summary.skipped.push({ prompt, method: port.method, reason: "rotation" });
          continue;
        }
        const need = perPrompt - (await args.store.countRuns(prompt, port.method, today));
        if (need <= 0) {
          summary.skippedAlreadyDone += 1;
          continue;
        }
        if (clock() >= deadline) {
          summary.skippedBudget += 1;
          summary.skipped.push({ prompt, method: port.method, reason: "budget" });
          continue;
        }
        if (startLeft !== null && startLeft <= 0) {
          summary.skippedCap += 1;
          summary.skipped.push({ prompt, method: port.method, reason: "cap" });
          continue;
        }
        const rows: GeoRunRow[] = [];
        let stopped: SkipReason | null = null;
        for (let i = 0; i < need; i += 1) {
          if (clock() >= deadline) {
            stopped = "budget";
            break;
          }
          if (cap !== null && !(await args.store.reserve(port.method, today, cap))) {
            stopped = "cap";
            break;
          }
          try {
            const result = await port.ask(prompt);
            const a = analyzeAnswer(result, args.subject);
            rows.push({
              prompt,
              engine: port.engine,
              method: port.method,
              runAt: now().toISOString(),
              mentioned: a.mentioned,
              cited: a.cited,
              competitors: a.competitors,
              sources: result.citedUrls.slice(0, 10),
              answerExcerpt: result.answer.slice(0, EXCERPT_CHARS),
            });
          } catch (err) {
            summary.failed.push({ prompt, method: port.method, error: err instanceof Error ? err.message : String(err) });
            break;
          }
        }
        // Keep whatever succeeded; a later run only tops up the difference.
        if (rows.length > 0) {
          await args.store.saveRuns(rows);
          summary.ran += rows.length;
        }
        if (stopped === "cap") summary.skippedCap += 1;
        if (stopped === "budget") summary.skippedBudget += 1;
        if (stopped) summary.skipped.push({ prompt, method: port.method, reason: stopped });
      }
    }
  } finally {
    await args.store.unlock();
  }
  return summary;
}
