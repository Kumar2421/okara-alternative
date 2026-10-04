import { suggestResourceId } from "./googleMatch.ts";
import type { IntegrationResource, IntegrationType, ProjectIntegration } from "./integrationTypes.ts";

export type ResourceUsageRow = { resourceId: string; projectName: string };

export type ConnectionState = {
  integrationType: IntegrationType;
  /** This project's own connection of that type, if any. */
  integration: ProjectIntegration | null;
  resources: IntegrationResource[];
};

export type GoogleResourcesView = {
  account: {
    connectedHere: boolean;
    /** Google is already connected for another of the user's projects, so no new consent is needed. */
    canReuse: boolean;
    email: string | null;
  };
  integrations: Array<{
    integrationType: IntegrationType;
    integrationId: string | null;
    /** The property that looks like this project's website; a suggestion, never auto-applied. */
    suggestedResourceId: string | null;
    resources: Array<IntegrationResource & { usedBy: string[] }>;
  }>;
};

/**
 * What the SEO tab needs to render the Google connect/choose flow. One pure
 * function so self-host (SQLite) and platform (Supabase) return an identical
 * shape from their own storage.
 */
export function buildGoogleResourcesView(input: {
  projectUrl: string | null | undefined;
  connections: ConnectionState[];
  usage: ResourceUsageRow[];
  /** Another project's connection, used only when this project has none. */
  sibling: ProjectIntegration | null;
}): GoogleResourcesView {
  const { projectUrl, connections, usage, sibling } = input;
  const own = connections.find((c) => c.integration)?.integration ?? null;

  return {
    account: {
      connectedHere: own !== null,
      canReuse: own === null && sibling !== null,
      email: own?.accountIdentifier ?? sibling?.accountIdentifier ?? null,
    },
    integrations: connections.map(({ integrationType, integration, resources }) => ({
      integrationType,
      integrationId: integration?.id ?? null,
      suggestedResourceId: suggestResourceId(projectUrl, integrationType, resources),
      resources: resources.map((resource) => ({
        ...resource,
        usedBy: [...new Set(usage.filter((u) => u.resourceId === resource.resourceId).map((u) => u.projectName))],
      })),
    })),
  };
}
