import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import {
  getProjectIntegration,
  listIntegrationResources,
  listResourceUsage,
  listSiblingIntegrations,
  selectIntegrationResource,
} from "@/lib/domain/integrations/integrationStore";
import {
  getProjectIntegration as getProjectIntegrationSupabase,
  listIntegrationResources as listIntegrationResourcesSupabase,
  listResourceUsage as listResourceUsageSupabase,
  listSiblingIntegrations as listSiblingIntegrationsSupabase,
  selectIntegrationResource as selectIntegrationResourceSupabase,
} from "@/lib/domain/integrations/integrationStoreSupabase";
import { buildGoogleResourcesView } from "@/lib/domain/integrations/googleResourcesView";
import { INTEGRATION_TYPES } from "@/lib/domain/integrations/integrationTypes";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

/**
 * What the SEO tab needs for the Google connect/choose flow, in both modes:
 * this project's connections and the account's full site/property lists, a
 * suggested match for the project's website, which other projects already use
 * each property, and whether a Google account connected for another project
 * can be reused.
 */
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

    const { data: project } = await db.from("projects").select("url").eq("id", projectId).eq("owner_id", user.id).maybeSingle();
    const connections = await Promise.all(
      INTEGRATION_TYPES.map(async (integrationType) => {
        const integration = await getProjectIntegrationSupabase(db, user.id, projectId, integrationType);
        return {
          integrationType,
          integration,
          resources: integration ? await listIntegrationResourcesSupabase(db, user.id, integration.id) : [],
        };
      })
    );
    const sibling = connections.some((c) => c.integration)
      ? null
      : (await Promise.all(INTEGRATION_TYPES.map((t) => listSiblingIntegrationsSupabase(db, user.id, projectId, t)))).flat()[0] ?? null;

    return NextResponse.json({
      projectId,
      ...buildGoogleResourcesView({
        projectUrl: project?.url,
        connections,
        usage: await listResourceUsageSupabase(db, user.id, projectId),
        sibling,
      }),
    });
  }

  const projectId = getActiveProjectId();
  if (!projectId) return NextResponse.json({ error: "No active project" }, { status: 422 });

  const project = getDb().prepare("SELECT url FROM projects WHERE id = ?").get(projectId) as { url: string | null } | undefined;
  const connections = INTEGRATION_TYPES.map((integrationType) => {
    const integration = getProjectIntegration(projectId, integrationType);
    return { integrationType, integration, resources: integration ? listIntegrationResources(integration.id) : [] };
  });
  const sibling = connections.some((c) => c.integration)
    ? null
    : INTEGRATION_TYPES.flatMap((t) => listSiblingIntegrations(projectId, t))[0] ?? null;

  return NextResponse.json({
    projectId,
    ...buildGoogleResourcesView({ projectUrl: project?.url, connections, usage: listResourceUsage(projectId), sibling }),
  });
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
