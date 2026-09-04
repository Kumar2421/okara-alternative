import { getDb } from "@/lib/db";

const POINTER_KEY = "active_project_id";

/** Which saved project is "active" — every agent route, Context, and
 * Analytics reads/writes against this one. Real multi-project support:
 * `projects` can hold many rows now, this pointer says which one is live.
 * Falls back to the legacy hardcoded 'active' id for anyone who created a
 * project before this pointer existed (see migrate() in lib/db.ts). */
export function getActiveProjectId(): string | null {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(POINTER_KEY) as
    | { value: string }
    | undefined;
  if (row?.value) return row.value;

  // Legacy fallback: a project row literally named 'active' from before this
  // pointer existed. Don't silently invent a pointer to a project that isn't
  // there.
  const legacy = db.prepare("SELECT id FROM projects WHERE id = 'active'").get() as { id: string } | undefined;
  return legacy?.id ?? null;
}

export function setActiveProjectId(id: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(POINTER_KEY, id);
}
