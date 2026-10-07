/**
 * Pure guards for the X Writer generation route: credit pre-check and the
 * daily batch reservation. No I/O, so the race logic is unit-testable.
 */

export type CreditState = { billingEnabled: boolean; balance: number; cost: number };

/** Mirrors spend_credits(): when billing is off nothing blocks; otherwise the balance must cover the cost. */
export function canAffordCredits(state: CreditState): boolean {
  if (!state.billingEnabled) return true;
  return state.balance >= state.cost;
}

/** A reservation that never finished (crashed request) stops counting after this long. */
export const PENDING_TTL_MS = 5 * 60 * 1000;

export type BatchRow = { batch_id: string | null; status: string | null; created_at: string };

/** Distinct batches since `sinceIso`; stale pending reservations are ignored. */
export function countActiveBatches(rows: BatchRow[], sinceIso: string, nowMs: number): number {
  const since = Date.parse(sinceIso);
  const ids = new Set<string>();
  for (const r of rows) {
    if (!r.batch_id) continue;
    const created = Date.parse(r.created_at);
    if (!(created >= since)) continue;
    if (r.status === "pending" && nowMs - created > PENDING_TTL_MS) continue;
    ids.add(r.batch_id);
  }
  return ids.size;
}

export type ReservationOps = {
  /** Insert a placeholder row that counts as one batch. */
  insert(batchId: string): Promise<void>;
  /** Distinct batches today, including every live placeholder. */
  count(): Promise<number>;
  remove(batchId: string): Promise<void>;
};

export type Reservation = { ok: true; batchId: string } | { ok: false; used: number };

/**
 * Reserve one batch slot before calling the model: insert first, then count.
 * Concurrent requests all see each other's placeholders, so the cap can never
 * be exceeded; in a tie every contender backs off, which errs on the safe side.
 */
export async function reserveBatchSlot(ops: ReservationOps, limit: number, newId: () => string): Promise<Reservation> {
  const batchId = newId();
  await ops.insert(batchId);
  try {
    const used = await ops.count();
    if (limit !== -1 && used > limit) {
      await ops.remove(batchId);
      return { ok: false, used: used - 1 };
    }
  } catch (err) {
    await ops.remove(batchId).catch(() => {});
    throw err;
  }
  return { ok: true, batchId };
}
