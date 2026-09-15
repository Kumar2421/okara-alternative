/** Search Console's `country` dimension returns lowercase ISO 3166-1
 * alpha-3 codes (e.g. "usa", "ind", "rus") — mapped here to a real alpha-2
 * code + display name for the UI. Covers the countries that actually show
 * up in search traffic for most sites; an unmapped code falls back to
 * showing itself uppercased rather than a fabricated name. */
const ALPHA3_TO_COUNTRY: Record<string, { alpha2: string; name: string }> = {
  usa: { alpha2: "US", name: "United States" },
  ind: { alpha2: "IN", name: "India" },
  gbr: { alpha2: "GB", name: "United Kingdom" },
  can: { alpha2: "CA", name: "Canada" },
  aus: { alpha2: "AU", name: "Australia" },
  deu: { alpha2: "DE", name: "Germany" },
  fra: { alpha2: "FR", name: "France" },
  esp: { alpha2: "ES", name: "Spain" },
  ita: { alpha2: "IT", name: "Italy" },
  nld: { alpha2: "NL", name: "Netherlands" },
  bra: { alpha2: "BR", name: "Brazil" },
  mex: { alpha2: "MX", name: "Mexico" },
  rus: { alpha2: "RU", name: "Russia" },
  chn: { alpha2: "CN", name: "China" },
  jpn: { alpha2: "JP", name: "Japan" },
  kor: { alpha2: "KR", name: "South Korea" },
  idn: { alpha2: "ID", name: "Indonesia" },
  phl: { alpha2: "PH", name: "Philippines" },
  vnm: { alpha2: "VN", name: "Vietnam" },
  tha: { alpha2: "TH", name: "Thailand" },
  sgp: { alpha2: "SG", name: "Singapore" },
  mys: { alpha2: "MY", name: "Malaysia" },
  pak: { alpha2: "PK", name: "Pakistan" },
  bgd: { alpha2: "BD", name: "Bangladesh" },
  nga: { alpha2: "NG", name: "Nigeria" },
  zaf: { alpha2: "ZA", name: "South Africa" },
  egy: { alpha2: "EG", name: "Egypt" },
  are: { alpha2: "AE", name: "United Arab Emirates" },
  sau: { alpha2: "SA", name: "Saudi Arabia" },
  tur: { alpha2: "TR", name: "Turkey" },
  pol: { alpha2: "PL", name: "Poland" },
  ukr: { alpha2: "UA", name: "Ukraine" },
  swe: { alpha2: "SE", name: "Sweden" },
  nor: { alpha2: "NO", name: "Norway" },
  dnk: { alpha2: "DK", name: "Denmark" },
  fin: { alpha2: "FI", name: "Finland" },
  che: { alpha2: "CH", name: "Switzerland" },
  aut: { alpha2: "AT", name: "Austria" },
  bel: { alpha2: "BE", name: "Belgium" },
  irl: { alpha2: "IE", name: "Ireland" },
  prt: { alpha2: "PT", name: "Portugal" },
  grc: { alpha2: "GR", name: "Greece" },
  cze: { alpha2: "CZ", name: "Czechia" },
  rou: { alpha2: "RO", name: "Romania" },
  isr: { alpha2: "IL", name: "Israel" },
  arg: { alpha2: "AR", name: "Argentina" },
  chl: { alpha2: "CL", name: "Chile" },
  col: { alpha2: "CO", name: "Colombia" },
  per: { alpha2: "PE", name: "Peru" },
  nzl: { alpha2: "NZ", name: "New Zealand" },
  hkg: { alpha2: "HK", name: "Hong Kong" },
  twn: { alpha2: "TW", name: "Taiwan" },
};

export function resolveCountry(alpha3: string): { code: string; name: string } {
  const match = ALPHA3_TO_COUNTRY[alpha3.toLowerCase()];
  if (match) return { code: match.alpha2, name: match.name };
  return { code: alpha3.slice(0, 2).toUpperCase(), name: alpha3.toUpperCase() };
}
