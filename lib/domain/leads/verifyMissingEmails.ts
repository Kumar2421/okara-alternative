import type { ExtractedLead } from "@/lib/domain/leads/LeadsAgent";
import { guessAndVerifyEmail } from "@/lib/domain/leads/emailVerify";

const SMTP_VERIFY_CONCURRENCY = 5;

/** Runs guessAndVerifyEmail only for leads search extraction left with no
 * email — bounded concurrency so we're not opening dozens of SMTP sockets
 * at once. Mutates nothing; returns which leads got a verified email.
 * Shared by the manual search route and the auto-generation path so both
 * stay in sync instead of drifting copies. */
export async function verifyMissingEmails(leads: ExtractedLead[]): Promise<Map<number, string>> {
  const verified = new Map<number, string>();
  const candidates = leads
    .map((lead, index) => ({ lead, index }))
    .filter(({ lead }) => !lead.email && lead.company && lead.name.trim().split(/\s+/).length >= 2);

  for (let i = 0; i < candidates.length; i += SMTP_VERIFY_CONCURRENCY) {
    const batch = candidates.slice(i, i + SMTP_VERIFY_CONCURRENCY);
    const results = await Promise.all(
      batch.map(({ lead }) => guessAndVerifyEmail(lead.name, lead.company).catch(() => null))
    );
    results.forEach((email, j) => {
      if (email) verified.set(batch[j].index, email);
    });
  }
  return verified;
}
