import { NextRequest, NextResponse } from "next/server";
import { resolveGeoContext } from "@/lib/domain/geo/geoContext";
import { listSavedPrompts, loadProject, savePrompts, suggestFromSearchConsole } from "@/lib/domain/geo/geoService";
import { mergePrompts, normalizePrompt } from "@/lib/domain/geo/promptSet";
import { MAX_TRACKED_PROMPTS, type GeoPrompt } from "@/lib/domain/geo/types";

/** Save the edited prompt list (max 10 active, deduped), or `{ action: "suggest" }` to add fresh Search Console suggestions. */
export async function PUT(req: NextRequest) {
  const r = await resolveGeoContext();
  if ("response" in r) return r.response;
  const body = (await req.json().catch(() => ({}))) as { prompts?: unknown; action?: string };
  try {
    if (body.action === "suggest") {
      const project = await loadProject(r.ctx);
      if (!project) return NextResponse.json({ error: "No project website linked yet." }, { status: 422 });
      const merged = mergePrompts(await listSavedPrompts(r.ctx), await suggestFromSearchConsole(r.ctx, project));
      await savePrompts(r.ctx, merged);
      return NextResponse.json({ prompts: merged });
    }
    if (!Array.isArray(body.prompts)) return NextResponse.json({ error: "prompts must be a list." }, { status: 400 });
    const seen = new Set<string>();
    const clean: GeoPrompt[] = [];
    for (const p of body.prompts as Array<Partial<GeoPrompt>>) {
      const text = typeof p.prompt === "string" ? p.prompt.trim().slice(0, 300) : "";
      const key = normalizePrompt(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      clean.push({ prompt: text, source: p.source === "gsc" ? "gsc" : "manual", active: p.active !== false });
    }
    let active = 0;
    const capped = clean.slice(0, 30).map((p) => (p.active && ++active > MAX_TRACKED_PROMPTS ? { ...p, active: false } : p));
    await savePrompts(r.ctx, capped);
    return NextResponse.json({ prompts: capped });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
