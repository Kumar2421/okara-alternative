export type LocalBizQuery = { category: string; location: string };

export type LocalBizLead = {
  name: string;
  phone: string | null;
  address: string | null;
  website: string | null;
  placeId: string;
};

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
// Places API (New) requires an explicit field mask — no default fields, and
// omitting it errors outright. Verified against Google's own docs, not assumed.
const FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri";

/**
 * Real local-business search via Places API (New) — structured official
 * data, not a scrape or an LLM guess. No extraction step needed here at all
 * (unlike person-search), so there's no hallucination surface by construction.
 */
export async function searchLocalBusinesses(apiKey: string, query: LocalBizQuery): Promise<LocalBizLead[]> {
  const res = await fetch(PLACES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: `${query.category} in ${query.location}` }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Places API failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ""}`);
  }

  const data = await res.json();
  const places: unknown[] = data.places ?? [];

  return places.map((p) => {
    const place = p as {
      id: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      nationalPhoneNumber?: string;
      websiteUri?: string;
    };
    return {
      name: place.displayName?.text ?? "(unnamed)",
      phone: place.nationalPhoneNumber ?? null,
      address: place.formattedAddress ?? null,
      website: place.websiteUri ?? null,
      placeId: place.id,
    };
  });
}
