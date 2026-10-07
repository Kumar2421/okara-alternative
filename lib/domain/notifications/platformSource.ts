import type { SupabaseClient } from "@supabase/supabase-js";
import { listProjectActions } from "@/lib/domain/actions/actionStoreSupabase";
import { readOutcomes } from "@/lib/domain/search/outcomeService";
import { platformOutcomePorts } from "@/lib/domain/search/outcomePorts";
import { projectFactsFromActions } from "./facts";
import type { SnapshotLike } from "./digest";
import type { NotificationSource, UserFacts } from "./job";

const DAY_MS = 86_400_000;

/** Provider connections that matter to the user, by the name shown to them. */
const PROVIDER_LABELS: Record<string, string> = { gsc: "Google Search Console", ga4: "Google Analytics", gmail: "Gmail" };

/** Just the 7-day window of a snapshot: the digest never needs the full payload. */
async function snapshotD7(db: SupabaseClient, userId: string, projectId: string, order: { before?: string; after?: string }): Promise<SnapshotLike | null> {
  let query = db.from("search_snapshots").select("snapshot_date, d7:payload->windows->d7").eq("project_id", projectId).eq("user_id", userId);
  if (order.before) query = query.lte("snapshot_date", order.before);
  if (order.after) query = query.gte("snapshot_date", order.after);
  const { data } = await query.order("snapshot_date", { ascending: false }).limit(1).maybeSingle();
  const d7 = data?.d7 as { queries?: unknown } | null | undefined;
  if (!data || !d7 || !Array.isArray(d7.queries)) return null;
  return { snapshotDate: String(data.snapshot_date), payload: { windows: { d7: d7 as SnapshotLike["payload"]["windows"]["d7"] } } };
}

/** Platform wiring: users with at least one project, facts read with the service client and scoped by user. */
export function platformNotificationSource(db: SupabaseClient): NotificationSource {
  return {
    async listUsers() {
      // PostgREST caps a response at 1000 rows, so page through a stable order (owner, then id):
      // an unordered, unpaged read could drop users differently on every run.
      const PAGE = 1000;
      const owners = new Set<string>();
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db.from("projects").select("owner_id").order("owner_id").order("id").range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        for (const row of data ?? []) owners.add(String(row.owner_id));
        if ((data ?? []).length < PAGE) break;
      }
      return [...owners].sort().map((userId) => ({ userId }));
    },

    async loadFacts(userId, now): Promise<UserFacts> {
      const [{ data: profile }, { data: config }, { data: grants }, { data: projects }, { data: connections }] = await Promise.all([
        db.from("profiles").select("email, credits_balance").eq("id", userId).maybeSingle(),
        db.from("app_config").select("billing_enabled").eq("id", true).maybeSingle(),
        db.from("credit_ledger").select("delta").eq("user_id", userId).gt("delta", 0),
        db.from("projects").select("id, name, url").eq("owner_id", userId).order("created_at"),
        db.from("integration_connections").select("provider, refresh_token_secret_id").eq("user_id", userId).in("provider", Object.keys(PROVIDER_LABELS)),
      ]);

      const projectFacts = [];
      for (const project of projects ?? []) {
        const projectId = String(project.id);
        const url = project.url ? String(project.url) : null;
        const actions = await listProjectActions(db, userId, projectId);
        const withOutcomes = await readOutcomes(platformOutcomePorts(db, userId, projectId, url), actions, now);
        const latest = await snapshotD7(db, userId, projectId, {});
        const weekAgo = latest
          ? await snapshotD7(db, userId, projectId, {
              // The snapshot nearest to a week before the latest, within a few days either way.
              before: new Date(Date.parse(latest.snapshotDate) - 5 * DAY_MS).toISOString().slice(0, 10),
              after: new Date(Date.parse(latest.snapshotDate) - 10 * DAY_MS).toISOString().slice(0, 10),
            })
          : null;
        projectFacts.push(projectFactsFromActions({ id: projectId, name: String(project.name) }, withOutcomes, { latest, weekAgo }, now));
      }

      // A connection that can no longer refresh its token needs the user to reconnect it.
      const integrations = (connections ?? [])
        .filter((c) => !c.refresh_token_secret_id)
        .map((c) => ({ id: String(c.provider), label: PROVIDER_LABELS[String(c.provider)] ?? String(c.provider), disconnected: true }));

      return {
        email: profile?.email ? String(profile.email) : null,
        projects: projectFacts,
        credits: profile
          ? {
              balance: Number(profile.credits_balance ?? 0),
              granted: (grants ?? []).reduce((sum, row) => sum + Number(row.delta), 0),
              billingEnabled: config?.billing_enabled === true,
            }
          : null,
        integrations,
      };
    },
  };
}
