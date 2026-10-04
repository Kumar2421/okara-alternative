import type { IntegrationResource, IntegrationSecrets, IntegrationType, ProjectIntegration } from "./integrationTypes.ts";

type MaybePromise<T> = T | Promise<T>;

/**
 * Storage operations the clone needs. Self-host (SQLite) and platform
 * (Supabase) each provide an adapter, so the orchestration below is written
 * and tested once.
 */
export type AccountConnectionPort = {
  /** This project's own connection of that type, if any. */
  own(integrationType: IntegrationType): MaybePromise<ProjectIntegration | null>;
  /** Other projects' connections of that type (same user), most recently updated first. */
  siblings(integrationType: IntegrationType): MaybePromise<ProjectIntegration[]>;
  upsert(integrationType: IntegrationType, accountIdentifier: string | null): MaybePromise<ProjectIntegration>;
  getSecrets(integrationId: string): MaybePromise<IntegrationSecrets | null>;
  saveSecrets(integrationId: string, secrets: IntegrationSecrets): MaybePromise<void>;
  listResources(integrationId: string): MaybePromise<IntegrationResource[]>;
  replaceResources(
    integrationId: string,
    resources: Omit<IntegrationResource, "id" | "integrationId" | "selected">[],
  ): MaybePromise<unknown>;
};

export type CloneResult = { cloned: IntegrationType[]; accountIdentifier: string | null };

const TYPES: IntegrationType[] = ["google-search-console", "google-analytics"];

/**
 * "Connect Google once per account": give this project a Google connection by
 * copying the tokens and the account's full property list from another of the
 * user's projects, with no second consent screen. Nothing is selected for the
 * new project (except when the account has exactly one property), so the user
 * picks that project's own site next.
 *
 * Never overwrites a connection the project already has, and skips a sibling
 * whose credentials are incomplete.
 */
export async function cloneAccountConnection(port: AccountConnectionPort): Promise<CloneResult> {
  const cloned: IntegrationType[] = [];
  let accountIdentifier: string | null = null;

  for (const type of TYPES) {
    if (await port.own(type)) continue;

    for (const sibling of await port.siblings(type)) {
      const secrets = await port.getSecrets(sibling.id);
      if (!secrets?.refreshToken) continue;

      const copy = await port.upsert(type, sibling.accountIdentifier);
      await port.saveSecrets(copy.id, secrets);
      const resources = await port.listResources(sibling.id);
      await port.replaceResources(
        copy.id,
        resources.map(({ resourceType, resourceId, resourceName, metadata }) => ({ resourceType, resourceId, resourceName, metadata })),
      );
      cloned.push(type);
      accountIdentifier = accountIdentifier ?? sibling.accountIdentifier;
      break;
    }
  }

  return { cloned, accountIdentifier };
}
