import { NextResponse } from "next/server";
import { resolveGeoContext } from "@/lib/domain/geo/geoContext";
import { getAiReferrals } from "@/lib/domain/geo/geoService";

export async function GET() {
  const r = await resolveGeoContext();
  if ("response" in r) return r.response;
  try {
    return NextResponse.json(await getAiReferrals(r.ctx));
  } catch (err) {
    // A Google Analytics hiccup should not break the GEO tab: report it as unavailable.
    return NextResponse.json({ unavailable: true, error: err instanceof Error ? err.message : String(err) });
  }
}
