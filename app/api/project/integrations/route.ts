import { NextResponse } from "next/server";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { listProjectIntegrations } from "@/lib/domain/integrations/integrationStore";

export async function GET() {
  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ projectId: null, integrations: [] });
  return NextResponse.json({ projectId, integrations: listProjectIntegrations(projectId) });
}
