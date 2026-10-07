import { analyzeAnswer, dayOf, type Subject } from "./visibility.ts";
import { remainingRuns } from "./dailyCap.ts";
import type { AnswerPort } from "./engines.ts";
import { RUNS_PER_PROMPT, type AnswerMethod, type GeoRunRow } from "./types.ts";

export type RunStore = {
  /** Runs already stored for this prompt + method on this UTC day. */
  countRuns(prompt: string, method: AnswerMethod, date: string): Promise<number>;
  /** All runs of this method for this user today, for the daily cap. */
  countMethodRunsToday(method: AnswerMethod, date: string): Promise<number>;
  saveRuns(rows: GeoRunRow[]): Promise<void>;
};

export type RunSummary = {
  ran: number;
  skippedAlreadyDone: number;
  skippedCap: number;
  skippedBudget: number;
  failed: Array<{ prompt: string; method: AnswerMethod; error: string }>;
};

const EXCERPT_CHARS = 400;

/**
 * Run every prompt RUNS_PER_PROMPT times per port. Idempotent per UTC day:
 * runs already stored today count toward the three, so a retry adds nothing
 * extra. Stops cleanly at the time budget or when a port's daily cap is hit.
 * `caps` maps method -> max calls per day (null/absent = unlimited).
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
  const summary: RunSummary = { ran: 0, skippedAlreadyDone: 0, skippedCap: 0, skippedBudget: 0, failed: [] };
  const today = dayOf(now().toISOString());

  for (const port of args.ports) {
    const cap = args.caps?.[port.method] ?? null;
    let left = remainingRuns(cap, await args.store.countMethodRunsToday(port.method, today));

    for (const prompt of args.prompts) {
      const need = RUNS_PER_PROMPT - (await args.store.countRuns(prompt, port.method, today));
      if (need <= 0) {
        summary.skippedAlreadyDone += 1;
        continue;
      }
      if (clock() >= deadline) {
        summary.skippedBudget += 1;
        continue;
      }
      if (left !== null && left < need) {
        summary.skippedCap += 1;
        continue;
      }
      const rows: GeoRunRow[] = [];
      for (let i = 0; i < need; i += 1) {
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
          if (left !== null) left -= 1;
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
    }
  }
  return summary;
}
