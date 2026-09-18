import { NextRequest, NextResponse } from "next/server";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { listProjectIntegrations } from "@/lib/domain/integrations/integrationStore";

export async function GET() {
  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ projectId: null, integrations: [] });
  return NextResponse.json({ projectId, integrations: listProjectIntegrations(projectId) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ error: "No active project" }, { status: 422 });
  if (!body?.integrationType) return NextResponse.json({ error: "integrationType is required" }, { status: 400 });
  return NextResponse.json({ projectId });
}
