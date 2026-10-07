import { getDb } from "@/lib/db";
import { listProjectActions } from "@/lib/domain/actions/actionStore";
import { readOutcomes } from "@/lib/domain/search/outcomeService";
import { selfHostOutcomePorts } from "@/lib/domain/search/outcomePorts";
import { projectFactsFromActions } from "./facts";
import type { SnapshotLike } from "./digest";
import type { NotificationSource, UserFacts } from "./job";
import { LOCAL_USER_ID } from "./notificationStore";

const DAY_MS = 86_400_000;

function snapshotD7(projectId: string, order: { before?: string; after?: string }): SnapshotLike | null {
  const clauses = ["project_id = ?"];
  const params: string[] = [projectId];
  if (order.before) { clauses.push("snapshot_date <= ?"); params.push(order.before); }
  if (order.after) { clauses.push("snapshot_date >= ?"); params.push(order.after); }
  const row = getDb()
    .prepare(`SELECT snapshot_date, payload FROM search_snapshots WHERE ${clauses.join(" AND ")} ORDER BY snapshot_date DESC LIMIT 1`)
    .get(...params) as { snapshot_date: string; payload: string } | undefined;
  if (!row) return null;
  try {
    const d7 = JSON.parse(row.payload)?.windows?.d7;
    return d7 && Array.isArray(d7.queries) ? { snapshotDate: row.snapshot_date, payload: { windows: { d7 } } } : null;
  } catch {
    return null;
  }
}

/**
 * Self-host: one local user. In-app notifications always work; email only
 * goes out when RESEND_API_KEY is set and a recipient is known
 * (NOTIFY_TO_EMAIL, else the connected Gmail address).
 */
export function selfHostNotificationSource(): NotificationSource {
  return {
    async listUsers() {
      return [{ userId: LOCAL_USER_ID }];
    },

    async loadFacts(_userId, now): Promise<UserFacts> {
      const db = getDb();
      const projects = db.prepare("SELECT id, name, url FROM projects ORDER BY created_at").all() as Array<{ id: string; name: string; url: string }>;
      const projectFacts = [];
      for (const project of projects) {
        const actions = listProjectActions(project.id);
        const withOutcomes = await readOutcomes(selfHostOutcomePorts(project.id, project.url || null), actions, now);
        const latest = snapshotD7(project.id, {});
        const weekAgo = latest
          ? snapshotD7(project.id, {
              before: new Date(Date.parse(latest.snapshotDate) - 5 * DAY_MS).toISOString().slice(0, 10),
              after: new Date(Date.parse(latest.snapshotDate) - 10 * DAY_MS).toISOString().slice(0, 10),
            })
          : null;
        projectFacts.push(projectFactsFromActions(project, withOutcomes, { latest, weekAgo }, now));
      }

      const gmail = db.prepare("SELECT value FROM settings WHERE key = 'gmail_email'").get() as { value: string } | undefined;
      return {
        email: process.env.NOTIFY_TO_EMAIL?.trim() || gmail?.value || null,
        projects: projectFacts,
        credits: null,
        integrations: [],
      };
    },
  };
}
