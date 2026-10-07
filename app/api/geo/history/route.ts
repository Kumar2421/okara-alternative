import { NextRequest, NextResponse } from "next/server";
import { resolveGeoContext } from "@/lib/domain/geo/geoContext";
import { getPromptHistory } from "@/lib/domain/geo/geoService";

export async function GET(req: NextRequest) {
  const r = await resolveGeoContext();
  if ("response" in r) return r.response;
  const prompt = req.nextUrl.searchParams.get("prompt");
  if (!prompt) return NextResponse.json({ error: "prompt is required." }, { status: 400 });
  try {
    return NextResponse.json({ runs: await getPromptHistory(r.ctx, prompt) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
