import type { SupabaseClient } from "@supabase/supabase-js";
import { getDriver } from "@/lib/llm";
import { LeadsAgent } from "@/lib/domain/leads/LeadsAgent";
import { deriveLeadTarget, pickRole } from "@/lib/domain/leads/leadTarget";
import { verifyMissingEmails } from "@/lib/domain/leads/verifyMissingEmails";
import { PLATFORM_PROVIDER_KEYS, PLATFORM_DEFAULT_MODELS } from "@/lib/llm/platformKeys";

// Free tier always runs on the platform's own key/model, never a user's BYOK
// connection — same reasoning as the "Managed by Marlo" cards: it's a free
// convenience baseline, not something billed against or dependent on what
// the user personally connected in Settings -> LLM Providers.
const AUTO_LEAD_PROVIDER_ID = "groq";

/** Why a run added nothing, so "no leads today" is explainable instead of silent. */
export type AutoLeadReason = "not_configured" | "no_tavily" | "search_failed" | "none_found" | "all_duplicates" | "save_failed";

export type AutoLeadResult = {
  added: number;
  reason: AutoLeadReason | null;
  /** Human-readable explanation when nothing was added. */
  message: string | null;
  /** Who this run looked for (the buyer profile), for logging and debugging. */
  target: { role: string; industry: string; location: string; source: string } | null;
};

const REASON_MESSAGES: Record<AutoLeadReason, string> = {
  not_configured: "Free lead generation isn't configured on this deployment (missing platform model key).",
  no_tavily: "Free lead generation needs a web-search key (TAVILY_API_KEY), which isn't configured.",
  search_failed: "The lead search failed.",
  none_found: "The search found no matching people this time.",
  all_duplicates: "Everything found was already in your leads.",
  save_failed: "Found leads but couldn't save them.",
};

function nothing(reason: AutoLeadReason, target: AutoLeadResult["target"] = null, detail?: string): AutoLeadResult {
  return { added: 0, reason, message: detail ? `${REASON_MESSAGES[reason]} ${detail}` : REASON_MESSAGES[reason], target };
}

/** Platform-only, free baseline lead generation — runs once at project
 * creation (up to CREATION_LIMIT) and once a day after that (up to
 * DAILY_LIMIT new leads). Deliberately unmetered (no chargeCredits call):
 * going past this free baseline is what the paid plan is for, via the
 * existing manual "Search Leads" flow in the Leads panel, which still
 * charges credits exactly as it does today. Self-host never calls this —
 * callers gate on FEATURES.PLATFORM_MODE before reaching it.
 *
 * Targets the product's BUYERS: the ICP written in its Marketing Strategy or
 * Product Info (roles, industry, location), rotating one buyer role per day
 * so repeated runs reach different people. With no ICP written down it falls
 * back to the project category, as before.
 */
export async function generateAutoLeads(
  db: SupabaseClient,
  userId: string,
  project: { id: string; name: string; category: string | null },
  limit: number
): Promise<AutoLeadResult> {
  const apiKey = PLATFORM_PROVIDER_KEYS[AUTO_LEAD_PROVIDER_ID];
  const model = PLATFORM_DEFAULT_MODELS[AUTO_LEAD_PROVIDER_ID];
  const driver = getDriver(AUTO_LEAD_PROVIDER_ID);
  if (!apiKey || !model || !driver) return nothing("not_configured");

  const tavilyKey = process.env.TAVILY_API_KEY?.trim() || "";
  if (!tavilyKey) return nothing("no_tavily");

  const { data: docs } = await db
    .from("project_documents")
    .select("doc_type, content")
    .eq("project_id", project.id)
    .in("doc_type", ["marketing_strategy", "product_info"]);
  const target = deriveLeadTarget({
    marketingStrategy: docs?.find((d) => d.doc_type === "marketing_strategy")?.content,
    productInfo: docs?.find((d) => d.doc_type === "product_info")?.content,
    category: project.category,
    name: project.name,
  });
  const role = pickRole(target.roles, new Date());
  const runTarget = { role, industry: target.industry, location: target.location, source: target.source };
  if (!target.industry.trim()) return nothing("none_found", runTarget);

  let leads;
  try {
    const agent = new LeadsAgent(driver, apiKey);
    leads = await agent.search({ role, companyOrIndustry: target.industry, location: target.location }, tavilyKey, model, undefined);
  } catch (err) {
    return nothing("search_failed", runTarget, err instanceof Error ? err.message.slice(0, 200) : undefined);
  }
  if (leads.length === 0) return nothing("none_found", runTarget);

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
  const queryLabel = `${role} ${target.industry}`.trim();

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
      query: queryLabel,
      created_at: now,
      auto_generated: true,
    });
    // Reserve this row's own identity so a duplicate later in the same
    // batch doesn't also get inserted.
    if (email) existingEmails.add(email.toLowerCase().trim());
    existingNameCompany.add(nameCompanyKey);
  }

  if (rows.length === 0) return nothing("all_duplicates", runTarget);

  const { error } = await db.from("leads").insert(rows);
  if (error) return nothing("save_failed", runTarget, error.message.slice(0, 200));
  return { added: rows.length, reason: null, message: null, target: runTarget };
}

/** Back-compat wrapper: just the count. */
export async function autoGenerateLeads(
  db: SupabaseClient,
  userId: string,
  project: { id: string; name: string; category: string | null },
  limit: number
): Promise<number> {
  return (await generateAutoLeads(db, userId, project, limit)).added;
}
