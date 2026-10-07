import { NextResponse } from "next/server";
import { resolveGeoContext } from "@/lib/domain/geo/geoContext";
import { getOverview } from "@/lib/domain/geo/geoService";

export async function GET() {
  const r = await resolveGeoContext();
  if ("response" in r) return r.response;
  try {
    const overview = await getOverview(r.ctx);
    if (!overview) return NextResponse.json({ error: "No project website linked yet. Add one in the project switcher first." }, { status: 422 });
    return NextResponse.json(overview);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
