export type LeadTarget = {
  /** Buyer job titles to search for, most mentioned first. Empty when the docs name none. */
  roles: string[];
  industry: string;
  location: string;
  /** Where the buyer profile came from, so a weak result is explainable. */
  source: "marketing-strategy" | "product-info" | "category";
};

type Doc = string | null | undefined;

const SECTION_START = /(ideal customer|\bicp\b|target (?:audience|customer|customers|market|buyer|buyers)|buyer persona|customer profile|who (?:we|it) serves?)/i;
const HEADING_LINE = /^\s{0,3}#{1,4}\s/;

const FUNCTIONS = "(?:marketing|growth|product|engineering|sales|operations|content|seo|revenue|demand generation|customer success|design|finance|technology|data|partnerships)";

const TITLE_PATTERN = new RegExp(
  [
    "co-?founders?", "founders?", "owners?", "ceo", "cto", "cmo", "coo", "cfo",
    `heads? of ${FUNCTIONS}`,
    `vp(?: of)? ${FUNCTIONS}`,
    `vice president(?: of)? ${FUNCTIONS}`,
    `directors? of ${FUNCTIONS}`,
    `${FUNCTIONS} (?:managers?|leads?|directors?|heads?)`,
    "growth marketers?", "marketers?", "product managers?",
  ].join("|"),
  "gi",
);

const ACRONYMS = new Set(["ceo", "cto", "cmo", "coo", "cfo", "vp", "seo"]);
const KNOWN_INDUSTRY = /\b(b2b saas|saas|e-?commerce|fintech|healthtech|edtech|marketing agencies|agencies|startups|enterprise software)\b/i;

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return word.toUpperCase();
      if (lower === "of") return lower;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/** The ICP / target-audience section of a markdown doc: its heading plus the lines below it. */
function icpSection(doc: string): string | null {
  const lines = doc.split("\n");
  const start = lines.findIndex((line) => SECTION_START.test(line) && (HEADING_LINE.test(line) || /^\s*\*\*/.test(line) || /:\s*$/.test(line) || line.length < 80));
  if (start < 0) return null;
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length && out.length < 16; i += 1) {
    if (HEADING_LINE.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

function rolesIn(text: string): string[] {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(TITLE_PATTERN)) {
    const normalized = match[0].toLowerCase().replace(/^co-?founders?$/, "founder").replace(/^heads of /, "head of ").replace(/s$/, "").replace(/\s+/g, " ").trim();
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([title]) => titleCase(title));
}

function labelled(text: string, labels: string): string | null {
  const match = text.match(new RegExp(`(?:${labels})\\s*[:\\-–]\\s*([^\\n.;]{2,60})`, "i"));
  return match ? match[1].replace(/[*_`]/g, "").trim() : null;
}

/**
 * Who to look for: the product's BUYERS (the ICP from its Marketing Strategy,
 * then Product Info), not people in the product's own industry. With no ICP
 * written down it falls back to the project category, exactly as before.
 * Pure and deterministic: no model call.
 */
export function deriveLeadTarget(input: {
  marketingStrategy: Doc;
  productInfo: Doc;
  category: string | null | undefined;
  name: string;
}): LeadTarget {
  const fallbackIndustry = (input.category?.trim() || input.name.trim());

  const candidates: Array<{ source: LeadTarget["source"]; doc: Doc }> = [
    { source: "marketing-strategy", doc: input.marketingStrategy },
    { source: "product-info", doc: input.productInfo },
  ];

  for (const { source, doc } of candidates) {
    if (!doc) continue;
    const section = icpSection(doc);
    if (!section) continue;
    const roles = rolesIn(section);
    if (roles.length === 0) continue;

    const industry =
      labelled(section, "industry|industries|vertical|sector") ??
      section.match(KNOWN_INDUSTRY)?.[1] ??
      fallbackIndustry;
    const location = labelled(section, "location|locations|region|regions|geography|geographies") ?? "";
    return { roles, industry: industry.trim(), location, source };
  }

  return { roles: [], industry: fallbackIndustry, location: "", source: "category" };
}

/** One buyer role per day, rotating, so repeated daily runs reach different people instead of re-finding the same ones. */
export function pickRole(roles: string[], date: Date): string {
  if (roles.length === 0) return "";
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - startOfYear) / 86_400_000);
  return roles[dayOfYear % roles.length];
}
