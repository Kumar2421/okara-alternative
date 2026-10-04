import test from "node:test";
import assert from "node:assert/strict";
import { hostOf, suggestResourceId } from "../lib/domain/integrations/googleMatch.ts";
import { cloneAccountConnection, type AccountConnectionPort } from "../lib/domain/integrations/cloneAccountConnection.ts";
import type { IntegrationResource, IntegrationSecrets, IntegrationType, ProjectIntegration } from "../lib/domain/integrations/integrationTypes.ts";

const res = (resourceId: string, resourceName = resourceId) => ({ resourceId, resourceName });

test("hostOf normalizes protocol, www, case and paths; rejects junk", () => {
  assert.equal(hostOf("https://www.Example.com/pricing?x=1"), "example.com");
  assert.equal(hostOf("example.com"), "example.com");
  assert.equal(hostOf(""), undefined);
  assert.equal(hostOf(null), undefined);
  assert.equal(hostOf("not a url at all"), undefined);
});

test("suggest GSC: matches domain and URL-prefix properties to the project host", () => {
  const sites = [res("sc-domain:other.com"), res("https://www.example.com/"), res("sc-domain:example.com")];
  assert.equal(suggestResourceId("https://example.com", "google-search-console", sites), "sc-domain:example.com");
});

test("suggest GSC: falls back to a URL-prefix property and ignores www on either side", () => {
  const sites = [res("https://www.example.com/"), res("sc-domain:other.com")];
  assert.equal(suggestResourceId("https://example.com/blog", "google-search-console", sites), "https://www.example.com/");
  assert.equal(suggestResourceId("https://www.example.com", "google-search-console", [res("sc-domain:www.example.com")]), "sc-domain:www.example.com");
});

test("suggest GSC: never guesses across similar domains", () => {
  const sites = [res("sc-domain:example.com.au"), res("sc-domain:myexample.com"), res("sc-domain:blog.example.com")];
  assert.equal(suggestResourceId("https://example.com", "google-search-console", sites), null);
});

test("suggest GSC: no project URL or no resources means no suggestion", () => {
  assert.equal(suggestResourceId(null, "google-search-console", [res("sc-domain:example.com")]), null);
  assert.equal(suggestResourceId("https://example.com", "google-search-console", []), null);
});

test("suggest GA4: matches the host or the brand word in the property name", () => {
  const props = [res("properties/1", "Other Site"), res("properties/2", "Example - Web"), res("properties/3", "Marlo example.com prod")];
  assert.equal(suggestResourceId("https://example.com", "google-analytics", props), "properties/3");
  assert.equal(suggestResourceId("https://example.com", "google-analytics", props.slice(0, 2)), "properties/2");
});

test("suggest GA4: a brand word inside a longer word does not match", () => {
  assert.equal(suggestResourceId("https://shop.com", "google-analytics", [res("properties/1", "Workshop analytics")]), null);
});

// ---- cloneAccountConnection ----

type Store = {
  integrations: Map<string, ProjectIntegration & { owner: string }>;
  secrets: Map<string, IntegrationSecrets>;
  resources: Map<string, IntegrationResource[]>;
};

function seedStore(): Store {
  const store: Store = { integrations: new Map(), secrets: new Map(), resources: new Map() };
  const add = (id: string, projectId: string, type: IntegrationType, email: string, updatedAt: string, secrets: IntegrationSecrets | null, resources: string[]) => {
    store.integrations.set(id, { id, owner: projectId, projectId, provider: "google", integrationType: type, status: "connected", accountIdentifier: email, connectedAt: updatedAt, updatedAt });
    if (secrets) store.secrets.set(id, secrets);
    store.resources.set(id, resources.map((r, i) => ({ id: `${id}-r${i}`, integrationId: id, resourceType: type === "google-analytics" ? "ga4_property" : "search_console_property", resourceId: r, resourceName: r, metadata: {}, selected: false })));
  };
  const tokens = { accessToken: "a", refreshToken: "r", expiresAt: 1 };
  add("old-gsc", "p-old", "google-search-console", "me@x.com", "2026-01-01", tokens, ["sc-domain:a.com", "sc-domain:b.com"]);
  add("new-gsc", "p-recent", "google-search-console", "me@x.com", "2026-09-01", tokens, ["sc-domain:a.com", "sc-domain:b.com", "sc-domain:c.com"]);
  add("recent-ga", "p-recent", "google-analytics", "me@x.com", "2026-09-01", tokens, ["properties/1", "properties/2"]);
  return store;
}

function portFor(store: Store, projectId: string): AccountConnectionPort {
  let counter = 0;
  return {
    own: (type) => [...store.integrations.values()].find((i) => i.projectId === projectId && i.integrationType === type) ?? null,
    siblings: (type) =>
      [...store.integrations.values()]
        .filter((i) => i.projectId !== projectId && i.integrationType === type)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    upsert: (type, email) => {
      const id = `${projectId}-${type}-${counter++}`;
      const row = { id, owner: projectId, projectId, provider: "google", integrationType: type, status: "connected" as const, accountIdentifier: email, connectedAt: "now", updatedAt: "now" };
      store.integrations.set(id, row);
      return row;
    },
    getSecrets: (id) => store.secrets.get(id) ?? null,
    saveSecrets: (id, secrets) => void store.secrets.set(id, secrets),
    listResources: (id) => store.resources.get(id) ?? [],
    replaceResources: (id, list) => {
      const type = store.integrations.get(id)!.integrationType;
      void type;
      store.resources.set(id, list.map((r, i) => ({ ...r, id: `${id}-c${i}`, integrationId: id, selected: false })));
    },
  };
}

test("clone copies tokens and the full property list from the most recent sibling", async () => {
  const store = seedStore();
  const result = await cloneAccountConnection(portFor(store, "p-new"));
  assert.deepEqual(result.cloned.sort(), ["google-analytics", "google-search-console"]);
  assert.equal(result.accountIdentifier, "me@x.com");

  const mine = [...store.integrations.values()].filter((i) => i.projectId === "p-new");
  assert.equal(mine.length, 2);
  const gsc = mine.find((i) => i.integrationType === "google-search-console")!;
  assert.equal(store.resources.get(gsc.id)!.length, 3, "copied from the most recently updated GSC connection");
  assert.equal(store.secrets.get(gsc.id)?.refreshToken, "r");
});

test("clone starts with nothing selected so the user chooses this project's site", async () => {
  const store = seedStore();
  await cloneAccountConnection(portFor(store, "p-new"));
  for (const i of store.integrations.values()) {
    if (i.projectId !== "p-new") continue;
    assert.equal(store.resources.get(i.id)!.some((r) => r.selected), false);
  }
});

test("clone never overwrites a connection the project already has", async () => {
  const store = seedStore();
  const result = await cloneAccountConnection(portFor(store, "p-recent"));
  assert.deepEqual(result.cloned, []);
  assert.equal(store.integrations.size, 3);
});

test("clone skips a sibling with incomplete credentials and uses the next one", async () => {
  const store = seedStore();
  store.secrets.delete("new-gsc");
  const result = await cloneAccountConnection(portFor(store, "p-new"));
  const gsc = [...store.integrations.values()].find((i) => i.projectId === "p-new" && i.integrationType === "google-search-console")!;
  assert.ok(result.cloned.includes("google-search-console"));
  assert.equal(store.resources.get(gsc.id)!.length, 2, "fell back to the older sibling's list");
});

test("clone is a no-op when the user has no connected Google account", async () => {
  const empty: Store = { integrations: new Map(), secrets: new Map(), resources: new Map() };
  assert.deepEqual(await cloneAccountConnection(portFor(empty, "p-new")), { cloned: [], accountIdentifier: null });
});

// ---- buildGoogleResourcesView ----

import { buildGoogleResourcesView } from "../lib/domain/integrations/googleResourcesView.ts";

function integration(id: string, type: IntegrationType, email: string | null = "me@x.com"): ProjectIntegration {
  return { id, projectId: "p", provider: "google", integrationType: type, status: "connected", accountIdentifier: email, connectedAt: "t", updatedAt: "t" };
}
function resource(integrationId: string, resourceId: string, selected = false): IntegrationResource {
  return { id: `${integrationId}:${resourceId}`, integrationId, resourceType: "x", resourceId, resourceName: resourceId, metadata: {}, selected };
}

test("view: not connected anywhere offers a fresh connect", () => {
  const view = buildGoogleResourcesView({
    projectUrl: "https://example.com",
    connections: [
      { integrationType: "google-search-console", integration: null, resources: [] },
      { integrationType: "google-analytics", integration: null, resources: [] },
    ],
    usage: [],
    sibling: null,
  });
  assert.deepEqual(view.account, { connectedHere: false, canReuse: false, email: null });
  assert.equal(view.integrations[0].integrationId, null);
});

test("view: connected for another project offers to reuse that account, with its email", () => {
  const view = buildGoogleResourcesView({
    projectUrl: "https://example.com",
    connections: [
      { integrationType: "google-search-console", integration: null, resources: [] },
      { integrationType: "google-analytics", integration: null, resources: [] },
    ],
    usage: [],
    sibling: integration("s1", "google-search-console", "owner@x.com"),
  });
  assert.deepEqual(view.account, { connectedHere: false, canReuse: true, email: "owner@x.com" });
});

test("view: suggests the matching site and labels properties other projects already use", () => {
  const gsc = integration("g1", "google-search-console");
  const view = buildGoogleResourcesView({
    projectUrl: "https://example.com",
    connections: [
      { integrationType: "google-search-console", integration: gsc, resources: [resource("g1", "sc-domain:example.com"), resource("g1", "sc-domain:other.com")] },
      { integrationType: "google-analytics", integration: null, resources: [] },
    ],
    usage: [
      { resourceId: "sc-domain:other.com", projectName: "Other Co" },
      { resourceId: "sc-domain:other.com", projectName: "Other Co" },
      { resourceId: "sc-domain:other.com", projectName: "Side Project" },
    ],
    sibling: null,
  });
  assert.equal(view.account.connectedHere, true);
  assert.equal(view.account.canReuse, false);
  const [gscView] = view.integrations;
  assert.equal(gscView.suggestedResourceId, "sc-domain:example.com");
  assert.deepEqual(gscView.resources.find((r) => r.resourceId === "sc-domain:other.com")?.usedBy, ["Other Co", "Side Project"]);
  assert.deepEqual(gscView.resources.find((r) => r.resourceId === "sc-domain:example.com")?.usedBy, []);
});

test("view: a project that already has a connection never offers to reuse another", () => {
  const view = buildGoogleResourcesView({
    projectUrl: null,
    connections: [{ integrationType: "google-search-console", integration: integration("g1", "google-search-console"), resources: [] }],
    usage: [],
    sibling: integration("s1", "google-search-console", "someone@else.com"),
  });
  assert.equal(view.account.canReuse, false);
  assert.equal(view.account.email, "me@x.com");
});
