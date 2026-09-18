export const INTEGRATION_TYPES = ["google-search-console", "google-analytics"] as const;

export type IntegrationType = (typeof INTEGRATION_TYPES)[number];

export type ProjectIntegration = {
  id: string;
  projectId: string;
  provider: string;
  integrationType: IntegrationType;
  status: "connected" | "error" | "disconnected";
  accountIdentifier: string | null;
  connectedAt: string;
  updatedAt: string;
};

export type IntegrationResource = {
  id: string;
  integrationId: string;
  resourceType: string;
  resourceId: string;
  resourceName: string;
  metadata: Record<string, unknown>;
  selected: boolean;
};

export type IntegrationSecrets = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};
