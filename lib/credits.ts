import { createServiceClient } from "@/utils/supabase/serviceClient";

export class InsufficientCreditsError extends Error {
  constructor() {
    super("insufficient_credits");
    this.name = "InsufficientCreditsError";
  }
}

/**
 * Charges credits for one agent action via the spend_credits RPC (atomic
 * check-then-decrement in Postgres — see migration 02_credit_system).
 * Platform mode only. Throws InsufficientCreditsError if the user can't
 * afford it; caller should turn that into a 402 response.
 */
export async function chargeCredits(
  userId: string,
  agentType: string,
  opts?: { projectId?: string; model?: string; tokensIn?: number; tokensOut?: number }
) {
  const db = createServiceClient();
  const { data, error } = await db.rpc("spend_credits", {
    p_user_id: userId,
    p_agent_type: agentType,
    p_project_id: opts?.projectId ?? null,
    p_model: opts?.model ?? null,
    p_tokens_in: opts?.tokensIn ?? null,
    p_tokens_out: opts?.tokensOut ?? null,
  });

  if (error) {
    if (error.message?.includes("insufficient_credits")) throw new InsufficientCreditsError();
    throw new Error(error.message);
  }

  return data;
}
