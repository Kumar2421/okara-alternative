import { NextRequest, NextResponse } from "next/server";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import {
  getProjectIntegration,
  listIntegrationResources,
  selectIntegrationResource,
} from "@/lib/domain/integrations/integrationStore";

export async function GET() {
  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ error: "No active project" }, { status: 422 });

  const integrations = ["google-search-console", "google-analytics"] as const;
  const result = integrations.map((integrationType) => {
    const integration = getProjectIntegration(projectId, integrationType);
    return {
      integrationType,
      integrationId: integration?.id ?? null,
      resources: integration ? listIntegrationResources(integration.id) : [],
    };
  });
  return NextResponse.json({ projectId, integrations: result });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const projectId = getActiveProjectId();
  if (!projectId || !body?.integrationType || !body?.resourceId) {
    return NextResponse.json({ error: "project, integrationType and resourceId are required" }, { status: 400 });
  }

  const integration = getProjectIntegration(projectId, body.integrationType);
  if (!integration) return NextResponse.json({ error: "Integration not connected for this project" }, { status: 404 });

  if (!selectIntegrationResource(integration.id, body.resourceId)) {
    return NextResponse.json({ error: "Resource not found for this integration" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
