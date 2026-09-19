import { NextRequest, NextResponse } from "next/server";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import {
  getProjectIntegration,
  listIntegrationResources,
  selectIntegrationResource,
} from "@/lib/domain/integrations/integrationStore";
import {
  getProjectIntegration as getProjectIntegrationSupabase,
  listIntegrationResources as listIntegrationResourcesSupabase,
  selectIntegrationResource as selectIntegrationResourceSupabase,
} from "@/lib/domain/integrations/integrationStoreSupabase";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

const INTEGRATION_TYPES = ["google-search-console", "google-analytics"] as const;

export async function GET() {
  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { data: setting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const projectId = setting?.value;
    if (!projectId) return NextResponse.json({ error: "No active project" }, { status: 422 });

    const result = await Promise.all(
      INTEGRATION_TYPES.map(async (integrationType) => {
        const integration = await getProjectIntegrationSupabase(db, user.id, projectId, integrationType);
        return {
          integrationType,
          integrationId: integration?.id ?? null,
          resources: integration ? await listIntegrationResourcesSupabase(db, user.id, integration.id) : [],
        };
      })
    );
    return NextResponse.json({ projectId, integrations: result });
  }

  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ error: "No active project" }, { status: 422 });

  const result = INTEGRATION_TYPES.map((integrationType) => {
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
  if (!body?.integrationType || !body?.resourceId) {
    return NextResponse.json({ error: "integrationType and resourceId are required" }, { status: 400 });
  }

  if (FEATURES.PLATFORM_MODE) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createServiceClient();
    const { data: setting } = await db
      .from("user_settings")
      .select("value")
      .eq("user_id", user.id)
      .eq("key", "active_project_id")
      .maybeSingle();
    const projectId = setting?.value;
    if (!projectId) return NextResponse.json({ error: "No active project" }, { status: 422 });

    const integration = await getProjectIntegrationSupabase(db, user.id, projectId, body.integrationType);
    if (!integration) return NextResponse.json({ error: "Integration not connected for this project" }, { status: 404 });

    if (!(await selectIntegrationResourceSupabase(db, user.id, integration.id, body.resourceId))) {
      return NextResponse.json({ error: "Resource not found for this integration" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }

  const projectId = getActiveProjectId();
  if (!projectId) {
    return NextResponse.json({ error: "No active project" }, { status: 422 });
  }

  const integration = getProjectIntegration(projectId, body.integrationType);
  if (!integration) return NextResponse.json({ error: "Integration not connected for this project" }, { status: 404 });

  if (!selectIntegrationResource(integration.id, body.resourceId)) {
    return NextResponse.json({ error: "Resource not found for this integration" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
