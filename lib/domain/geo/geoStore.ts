import type Database from "better-sqlite3";
import type { RunStore } from "./runner.ts";
import type { AnswerMethod, GeoPrompt, GeoRunRow } from "./types.ts";

// Self-host (SQLite) store. Takes the database explicitly so tests can use an in-memory one.

type RunRecord = {
  prompt: string; engine: string; method: string; run_at: string; mentioned: number; cited: number;
  competitors: string; sources: string; answer_excerpt: string;
};

export function listPrompts(db: Database.Database, projectId: string): GeoPrompt[] {
  const rows = db
    .prepare("SELECT prompt, source, active FROM geo_prompts WHERE project_id = ? ORDER BY rowid")
    .all(projectId) as { prompt: string; source: string; active: number }[];
  return rows.map((r) => ({ prompt: r.prompt, source: r.source === "manual" ? "manual" : "gsc", active: r.active === 1 }));
}

/** Replace the project's prompt list with exactly `prompts`. */
export function replacePrompts(db: Database.Database, projectId: string, prompts: GeoPrompt[]): void {
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM geo_prompts WHERE project_id = ?").run(projectId);
    const insert = db.prepare("INSERT INTO geo_prompts (project_id, prompt, source, active) VALUES (?, ?, ?, ?)");
    for (const p of prompts) insert.run(projectId, p.prompt, p.source, p.active ? 1 : 0);
  });
  tx();
}

export function listRuns(db: Database.Database, projectId: string, sinceIso: string): GeoRunRow[] {
  const rows = db
    .prepare("SELECT * FROM geo_runs WHERE project_id = ? AND run_at >= ? ORDER BY run_at DESC")
    .all(projectId, sinceIso) as RunRecord[];
  return rows.map((r) => ({
    prompt: r.prompt,
    engine: r.engine,
    method: r.method as AnswerMethod,
    runAt: r.run_at,
    mentioned: r.mentioned === 1,
    cited: r.cited === 1,
    competitors: JSON.parse(r.competitors) as string[],
    sources: JSON.parse(r.sources) as string[],
    answerExcerpt: r.answer_excerpt,
  }));
}

export function sqliteRunStore(db: Database.Database, projectId: string): RunStore {
  return {
    async countRuns(prompt, method, date) {
      const row = db
        .prepare("SELECT COUNT(*) AS n FROM geo_runs WHERE project_id = ? AND prompt = ? AND method = ? AND substr(run_at, 1, 10) = ?")
        .get(projectId, prompt, method, date) as { n: number };
      return row.n;
    },
    async countMethodRunsToday(method, date) {
      const row = db.prepare("SELECT used FROM geo_usage WHERE method = ? AND day = ?").get(method, date) as { used: number } | undefined;
      return row?.used ?? 0;
    },
    async reserve(method, date, cap) {
      // better-sqlite3 transactions are synchronous, so check-and-increment cannot interleave.
      return db.transaction(() => {
        const row = db.prepare("SELECT used FROM geo_usage WHERE method = ? AND day = ?").get(method, date) as { used: number } | undefined;
        if ((row?.used ?? 0) + 1 > cap) return false;
        db.prepare("INSERT INTO geo_usage (method, day, used) VALUES (?, ?, 1) ON CONFLICT (method, day) DO UPDATE SET used = used + 1").run(method, date);
        return true;
      })();
    },
    async tryLock(ttlMs) {
      const now = Date.now();
      return db.transaction(() => {
        const row = db.prepare("SELECT locked_until FROM geo_locks WHERE project_id = ?").get(projectId) as { locked_until: number } | undefined;
        if (row && row.locked_until > now) return false;
        db.prepare("INSERT INTO geo_locks (project_id, locked_until) VALUES (?, ?) ON CONFLICT (project_id) DO UPDATE SET locked_until = excluded.locked_until").run(projectId, now + ttlMs);
        return true;
      })();
    },
    async unlock() {
      db.prepare("DELETE FROM geo_locks WHERE project_id = ?").run(projectId);
    },
    async saveRuns(rows) {
      const insert = db.prepare(
        `INSERT INTO geo_runs (project_id, prompt, engine, method, run_at, mentioned, cited, competitors, sources, answer_excerpt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      db.transaction(() => {
        for (const r of rows) {
          insert.run(projectId, r.prompt, r.engine, r.method, r.runAt, r.mentioned ? 1 : 0, r.cited ? 1 : 0,
            JSON.stringify(r.competitors), JSON.stringify(r.sources), r.answerExcerpt);
        }
      })();
    },
  };
}
