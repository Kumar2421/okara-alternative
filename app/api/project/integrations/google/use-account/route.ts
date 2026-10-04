import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cloneAccountConnection, type AccountConnectionPort } from "@/lib/domain/integrations/cloneAccountConnection";
import {
  getIntegrationSecrets as getIntegrationSecretsSqlite,
  getProjectIntegration as getProjectIntegrationSqlite,
  listIntegrationResources as listIntegrationResourcesSqlite,
  listSiblingIntegrations as listSiblingIntegrationsSqlite,
  replaceIntegrationResources as replaceIntegrationResourcesSqlite,
  saveIntegrationSecrets as saveIntegrationSecretsSqlite,
  upsertProjectIntegration as upsertProjectIntegrationSqlite,
} from "@/lib/domain/integrations/integrationStore";
import {
  getIntegrationSecrets,
  getProjectIntegration,
  listIntegrationResources,
  listSiblingIntegrations,
  replaceIntegrationResources,
  saveIntegrationSecrets,
  upsertProjectIntegration,
} from "@/lib/domain/integrations/integrationStoreSupabase";
import { getActiveProjectId } from "@/lib/domain/shared/getActiveProjectId";
import { FEATURES } from "@/lib/features";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/utils/supabase/serviceClient";

function platformPort(db: SupabaseClient, userId: string, projectId: string): AccountConnectionPort {
  return {
    own: (type) => getProjectIntegration(db, userId, projectId, type),
    siblings: (type) => listSiblingIntegrations(db, userId, projectId, type),
    upsert: (type, accountIdentifier) => upsertProjectIntegration(db, userId, { projectId, integrationType: type, accountIdentifier }),
    getSecrets: (id) => getIntegrationSecrets(db, userId, id),
    saveSecrets: (id, secrets) => saveIntegrationSecrets(db, userId, id, secrets),
    listResources: (id) => listIntegrationResources(db, userId, id),
    replaceResources: (id, resources) => replaceIntegrationResources(db, userId, id, resources),
  };
}

function selfHostPort(projectId: string): AccountConnectionPort {
  return {
    own: (type) => getProjectIntegrationSqlite(projectId, type),
    siblings: (type) => listSiblingIntegrationsSqlite(projectId, type),
    upsert: (type, accountIdentifier) =>
      upsertProjectIntegrationSqlite({ projectId, provider: "google", integrationType: type, accountIdentifier }),
    getSecrets: (id) => getIntegrationSecretsSqlite(id),
    saveSecrets: (id, secrets) => saveIntegrationSecretsSqlite(id, secrets),
    listResources: (id) => listIntegrationResourcesSqlite(id),
    replaceResources: (id, resources) => replaceIntegrationResourcesSqlite(id, resources),
  };
}

/**
 * Reuse the Google account the user already connected for another project:
 * copies the credentials and the account's site/property list to the active
 * project, with no second consent screen. The user then picks this project's
 * own Search Console site and GA4 property. Works in both modes.
 */
export async function POST() {
  try {
    let port: AccountConnectionPort;

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

      const { data: project } = await db.from("projects").select("id").eq("id", projectId).eq("owner_id", user.id).maybeSingle();
      if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
      port = platformPort(db, user.id, projectId);
    } else {
      const projectId = getActiveProjectId();
      if (!projectId) return NextResponse.json({ error: "No active project" }, { status: 422 });
      port = selfHostPort(projectId);
    }

    const result = await cloneAccountConnection(port);
    if (result.cloned.length === 0) {
      return NextResponse.json({ error: "No connected Google account was found to reuse. Connect Google first." }, { status: 409 });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
