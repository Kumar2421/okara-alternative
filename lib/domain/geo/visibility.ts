import type { AnswerMethod, EngineAnswer, GeoRunRow } from "./types.ts";

export type Subject = {
  brand: string;
  /** Bare domain, e.g. "example.com". */
  domain: string;
  /** Competitor names or domains. */
  competitors: string[];
};

export type RunAnalysis = { mentioned: boolean; cited: boolean; competitors: string[] };

function host(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionsTerm(text: string, term: string): boolean {
  const t = term.trim();
  if (!t) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}(?![\\p{L}\\p{N}])`, "iu").test(text);
}

function matchesDomain(h: string, domain: string): boolean {
  const d = domain.replace(/^www\./, "").toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/** Mentioned = brand or domain named in the answer text. Cited = one of the sources is on your domain. */
export function analyzeAnswer(result: EngineAnswer, subject: Subject): RunAnalysis {
  const hosts = result.citedUrls.map(host).filter((h): h is string => !!h);
  const cited = hosts.some((h) => matchesDomain(h, subject.domain));
  const mentioned = mentionsTerm(result.answer, subject.brand) || mentionsTerm(result.answer, subject.domain);
  const competitors: string[] = [];
  for (const c of subject.competitors) {
    const bare = c.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");
    const isDomain = bare.includes(".");
    // Competitors are usually stored as domains, but answers name the brand ("hubspot"), so match the first label too.
    const label = isDomain ? bare.split(".")[0] : "";
    const hit =
      mentionsTerm(result.answer, c) ||
      (isDomain && (mentionsTerm(result.answer, bare) || (label.length >= 4 && mentionsTerm(result.answer, label)) || hosts.some((h) => matchesDomain(h, bare))));
    if (hit && !competitors.includes(c)) competitors.push(c);
  }
  return { mentioned, cited, competitors };
}

export type Aggregate = {
  method: AnswerMethod;
  runs: number;
  mentionRate: number;
  citedRate: number;
  /** Competitor name -> share of runs that named it. */
  competitorRates: Record<string, number>;
};

/** Rates over runs of ONE method. Methods are never mixed. */
export function aggregateRuns(
  runs: Pick<GeoRunRow, "method" | "mentioned" | "cited" | "competitors">[],
  method: AnswerMethod,
): Aggregate {
  const own = runs.filter((r) => r.method === method);
  const n = own.length;
  const competitorRates: Record<string, number> = {};
  for (const r of own) for (const c of new Set(r.competitors)) competitorRates[c] = (competitorRates[c] ?? 0) + 1;
  for (const c of Object.keys(competitorRates)) competitorRates[c] = competitorRates[c] / n;
  return {
    method,
    runs: n,
    mentionRate: n === 0 ? 0 : own.filter((r) => r.mentioned).length / n,
    citedRate: n === 0 ? 0 : own.filter((r) => r.cited).length / n,
    competitorRates,
  };
}

export const dayOf = (iso: string): string => iso.slice(0, 10);

/** One method's rates per day, newest first. */
export function ratesByDay(
  runs: Pick<GeoRunRow, "method" | "mentioned" | "cited" | "competitors" | "runAt">[],
  method: AnswerMethod,
): Array<{ date: string; runs: number; mentionRate: number; citedRate: number }> {
  const days = [...new Set(runs.filter((r) => r.method === method).map((r) => dayOf(r.runAt)))].sort().reverse();
  return days.map((date) => {
    const a = aggregateRuns(runs.filter((r) => dayOf(r.runAt) === date), method);
    return { date, runs: a.runs, mentionRate: a.mentionRate, citedRate: a.citedRate };
  });
}

export type Trend = "up" | "down" | "flat" | "new";

/** Compare the latest day's mention rate with the previous day that has runs. Moves under 0.2 are noise at 3 runs. */
export function compareTrend(
  runs: Pick<GeoRunRow, "method" | "mentioned" | "cited" | "competitors" | "runAt">[],
  method: AnswerMethod,
  threshold = 0.2,
): { trend: Trend; latest: number | null; previous: number | null } {
  const days = ratesByDay(runs, method);
  if (days.length === 0) return { trend: "new", latest: null, previous: null };
  if (days.length === 1) return { trend: "new", latest: days[0].mentionRate, previous: null };
  const [latest, previous] = days;
  const diff = latest.mentionRate - previous.mentionRate;
  return { trend: Math.abs(diff) < threshold ? "flat" : diff > 0 ? "up" : "down", latest: latest.mentionRate, previous: previous.mentionRate };
}
