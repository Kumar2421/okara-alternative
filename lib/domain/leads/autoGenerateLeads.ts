import type { SupabaseClient } from "@supabase/supabase-js";
import { getDriver } from "@/lib/llm";
import { LeadsAgent } from "@/lib/domain/leads/LeadsAgent";
import { verifyMissingEmails } from "@/lib/domain/leads/verifyMissingEmails";
import { PLATFORM_PROVIDER_KEYS, PLATFORM_DEFAULT_MODELS } from "@/lib/llm/platformKeys";

// Free tier always runs on the platform's own key/model, never a user's BYOK
// connection — same reasoning as the "Managed by Marlo" cards: it's a free
// convenience baseline, not something billed against or dependent on what
// the user personally connected in Settings -> LLM Providers.
const AUTO_LEAD_PROVIDER_ID = "groq";

/** Platform-only, free baseline lead generation — runs once at project
 * creation (up to CREATION_LIMIT) and once a day after that (up to
 * DAILY_LIMIT new leads). Deliberately unmetered (no chargeCredits call):
 * going past this free baseline is what the paid plan is for, via the
 * existing manual "Search Leads" flow in the Leads panel, which still
 * charges credits exactly as it does today. Self-host never calls this —
 * callers gate on FEATURES.PLATFORM_MODE before reaching it.
 *
 * Returns how many new leads were actually inserted (0 if the operator
 * hasn't configured a Groq key, the search found nothing, or everything
 * found was a duplicate of an existing lead for this project).
 */
export async function autoGenerateLeads(
  db: SupabaseClient,
  userId: string,
  project: { id: string; name: string; category: string | null },
  limit: number
): Promise<number> {
  const apiKey = PLATFORM_PROVIDER_KEYS[AUTO_LEAD_PROVIDER_ID];
  const model = PLATFORM_DEFAULT_MODELS[AUTO_LEAD_PROVIDER_ID];
  if (!apiKey || !model) return 0;

  const driver = getDriver(AUTO_LEAD_PROVIDER_ID);
  if (!driver) return 0;

  const tavilyKey = process.env.TAVILY_API_KEY?.trim() || "";
  const companyOrIndustry = (project.category || project.name).trim();
  if (!companyOrIndustry) return 0;

  let leads;
  try {
    const agent = new LeadsAgent(driver, apiKey);
    leads = await agent.search({ role: "", companyOrIndustry, location: "" }, tavilyKey, model, undefined);
  } catch {
    return 0;
  }
  if (leads.length === 0) return 0;

  // Dedup against every lead already saved for this project -- by email
  // where we have one, else by name+company. Manual search has no dedup at
  // all today (a pre-existing gap, out of scope here), but a feature that
  // re-runs itself daily absolutely cannot skip this or the same handful of
  // people would get re-added every day forever.
  const { data: existingRows } = await db.from("leads").select("email, name, company").eq("project_id", project.id);
  const existingEmails = new Set(
    (existingRows ?? []).map((r) => r.email?.toLowerCase().trim()).filter((v): v is string => !!v)
  );
  const existingNameCompany = new Set(
    (existingRows ?? [])
      .filter((r) => r.name && r.company)
      .map((r) => `${r.name!.toLowerCase().trim()}|${r.company!.toLowerCase().trim()}`)
  );

  const verifiedEmails = await verifyMissingEmails(leads);
  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];

  for (let i = 0; i < leads.length && rows.length < limit; i++) {
    const lead = leads[i];
    const verifiedEmail = verifiedEmails.get(i);
    const email = lead.email ?? verifiedEmail ?? null;
    const nameCompanyKey = `${lead.name.toLowerCase().trim()}|${lead.company.toLowerCase().trim()}`;

    if (email && existingEmails.has(email.toLowerCase().trim())) continue;
    if (existingNameCompany.has(nameCompanyKey)) continue;

    rows.push({
      user_id: userId,
      project_id: project.id,
      name: lead.name,
      title: lead.title,
      company: lead.company,
      location: lead.location,
      email,
      email_verified: !lead.email && !!verifiedEmail,
      source_url: lead.sourceUrl,
      query: companyOrIndustry,
      created_at: now,
      auto_generated: true,
    });
    // Reserve this row's own identity so a duplicate later in the same
    // batch doesn't also get inserted.
    if (email) existingEmails.add(email.toLowerCase().trim());
    existingNameCompany.add(nameCompanyKey);
  }

  if (rows.length === 0) return 0;

  const { error } = await db.from("leads").insert(rows);
  if (error) return 0;
  return rows.length;
}
