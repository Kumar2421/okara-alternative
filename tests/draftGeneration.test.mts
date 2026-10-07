/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import test from "node:test";
import assert from "node:assert/strict";
import {
  generateDraftBatch,
  type DraftGenerationPorts,
  InsufficientCreditsError,
} from "../lib/domain/social/draftGeneration.ts";

// Test helpers
function createMockPorts(overrides?: Partial<DraftGenerationPorts>): DraftGenerationPorts {
  const callCounts = {
    creditState: 0,
    reserveSlot: 0,
    releaseSlot: 0,
    callModel: 0,
    parse: 0,
    filterUsable: 0,
    insertDrafts: 0,
    deleteBatch: 0,
    charge: 0,
  };

  const ports: DraftGenerationPorts = {
    creditState: async () => {
      callCounts.creditState++;
      return { billingEnabled: true, balance: 100, cost: 10 };
    },
    reserveSlot: async (limit) => {
      callCounts.reserveSlot++;
      return { ok: true, batchId: "batch_123" };
    },
    releaseSlot: async (batchId) => {
      callCounts.releaseSlot++;
    },
    callModel: async () => {
      callCounts.callModel++;
      return '{"drafts":[{"text":"Hello world"}]}';
    },
    parse: (text) => {
      callCounts.parse++;
      return { drafts: [{ text: "Hello world" }], errors: [] };
    },
    filterUsable: (drafts) => {
      callCounts.filterUsable++;
      return drafts;
    },
    insertDrafts: async (batchId, drafts) => {
      callCounts.insertDrafts++;
      return drafts.map((d: any, i) => ({ ...d, id: `id_${i}`, batchId }));
    },
    deleteBatch: async (batchId) => {
      callCounts.deleteBatch++;
    },
    charge: async () => {
      callCounts.charge++;
    },
    isByok: false,
    limit: 5,
    ...overrides,
  };

  (ports as any).callCounts = callCounts;
  return ports;
}

test("out of credits returns 402 and never calls model", async () => {
  const ports = createMockPorts({
    creditState: async () => ({
      billingEnabled: true,
      balance: 5,
      cost: 10,
    }),
  });

  const result = await generateDraftBatch(ports, { variants: 1 });

  assert.strictEqual(result.status, 402);
  assert.match((result.body as any).error, /Out of credits/);
  assert.strictEqual((ports as any).callCounts.callModel, 0);
  assert.strictEqual((ports as any).callCounts.charge, 0);
});

test("billing disabled bypasses credit check", async () => {
  const ports = createMockPorts({
    creditState: async () => ({
      billingEnabled: false,
      balance: 0,
      cost: 10,
    }),
  });

  const result = await generateDraftBatch(ports, { variants: 1 });

  assert.strictEqual(result.status, 201);
});

test("slot reservation refused returns 429 and never calls model", async () => {
  const ports = createMockPorts({
    reserveSlot: async () => ({ ok: false, used: 5 }),
  });

  const result = await generateDraftBatch(ports, { variants: 1 });

  assert.strictEqual(result.status, 429);
  assert.match((result.body as any).error, /Daily limit reached/);
  assert.strictEqual((ports as any).callCounts.callModel, 0);
  assert.strictEqual((ports as any).callCounts.releaseSlot, 0);
});

test("model failure returns 502 and releases slot", async () => {
  const ports = createMockPorts({
    callModel: async () => {
      throw new Error("Model API error");
    },
  });

  const result = await generateDraftBatch(ports, { variants: 1 });

  assert.strictEqual(result.status, 502);
  assert.strictEqual((ports as any).callCounts.releaseSlot, 1);
  assert.strictEqual((ports as any).callCounts.charge, 0);
});

test("parse yields nothing returns 502 and releases slot", async () => {
  const ports = createMockPorts({
    parse: () => ({ drafts: [], errors: ["No valid drafts"] }),
  });

  const result = await generateDraftBatch(ports, { variants: 1 });

  assert.strictEqual(result.status, 502);
  assert.match((result.body as any).error, /couldn't use/);
  assert.strictEqual((ports as any).callCounts.releaseSlot, 1);
  assert.strictEqual((ports as any).callCounts.charge, 0);
});

test("filterUsable returns empty returns 502 and releases slot", async () => {
  const ports = createMockPorts({
    parse: () => ({ drafts: [{ text: "Bad" }], errors: [] }),
    filterUsable: () => [],
  });

  const result = await generateDraftBatch(ports, { variants: 1 });

  assert.strictEqual(result.status, 502);
  assert.strictEqual((ports as any).callCounts.releaseSlot, 1);
});

test("insert throws releases slot and no charge", async () => {
  const ports = createMockPorts({
    insertDrafts: async () => {
      throw new Error("Database error");
    },
  });

  const result = await generateDraftBatch(ports, { variants: 1 });

  assert.strictEqual(result.status, 500);
  assert.strictEqual((ports as any).callCounts.releaseSlot, 1);
  assert.strictEqual((ports as any).callCounts.charge, 0);
});

test("charge fails with InsufficientCreditsError deletes batch and returns 402", async () => {
  const ports = createMockPorts({
    charge: async () => {
      throw new InsufficientCreditsError("Insufficient credits");
    },
  });

  const result = await generateDraftBatch(ports, { variants: 1 });

  assert.strictEqual(result.status, 402);
  assert.strictEqual((ports as any).callCounts.deleteBatch, 1);
  assert.strictEqual((ports as any).callCounts.releaseSlot, 0);
});

test("charge fails with other error bubbles up", async () => {
  const ports = createMockPorts({
    charge: async () => {
      throw new Error("Unknown charge error");
    },
  });

  const result = await generateDraftBatch(ports, { variants: 1 });

  assert.strictEqual(result.status, 500);
});

test("BYOK never calls creditState and never calls charge", async () => {
  const ports = createMockPorts({ isByok: true });

  const result = await generateDraftBatch(ports, { variants: 1 });

  assert.strictEqual(result.status, 201);
  assert.strictEqual((ports as any).callCounts.creditState, 0);
  assert.strictEqual((ports as any).callCounts.charge, 0);
});

test("BYOK with limit -1 never reserves slot", async () => {
  const ports = createMockPorts({ isByok: true, limit: -1 });

  const result = await generateDraftBatch(ports, { variants: 1 });

  assert.strictEqual(result.status, 201);
  assert.strictEqual((ports as any).callCounts.reserveSlot, 0);
});

test("limit -1 never reserves slot even for non-BYOK", async () => {
  const ports = createMockPorts({ limit: -1 });

  const result = await generateDraftBatch(ports, { variants: 1 });

  assert.strictEqual(result.status, 201);
  assert.strictEqual((ports as any).callCounts.reserveSlot, 0);
});

test("success path charges exactly once and returns 201", async () => {
  const ports = createMockPorts();

  const result = await generateDraftBatch(ports, { variants: 1 });

  assert.strictEqual(result.status, 201);
  assert.strictEqual((ports as any).callCounts.charge, 1);
  assert.strictEqual((ports as any).callCounts.deleteBatch, 0);
  assert.deepStrictEqual((result.body as any).drafts, [
    { text: "Hello world", id: "id_0", batchId: "batch_123" },
  ]);
});

test("success path calls in correct order", async () => {
  const callOrder: string[] = [];

  const ports = createMockPorts({
    creditState: async () => {
      callOrder.push("creditState");
      return { billingEnabled: true, balance: 100, cost: 10 };
    },
    reserveSlot: async () => {
      callOrder.push("reserveSlot");
      return { ok: true, batchId: "batch_123" };
    },
    callModel: async () => {
      callOrder.push("callModel");
      return '{"drafts":[]}';
    },
    parse: () => {
      callOrder.push("parse");
      return { drafts: [{ text: "Hello" }] };
    },
    filterUsable: (drafts) => {
      callOrder.push("filterUsable");
      return drafts;
    },
    insertDrafts: async () => {
      callOrder.push("insertDrafts");
      return [{ id: "1", batchId: "batch_123" }];
    },
    charge: async () => {
      callOrder.push("charge");
    },
  });

  await generateDraftBatch(ports, { variants: 1 });

  assert.deepStrictEqual(callOrder, [
    "creditState",
    "reserveSlot",
    "callModel",
    "parse",
    "filterUsable",
    "insertDrafts",
    "charge",
  ]);
});

test("parallel calls with fake counter never exceed limit", async () => {
  let reservationCount = 0;
  const maxReservations = 2;

  const createPortsWithCounter = (id: number): DraftGenerationPorts => {
    return createMockPorts({
      reserveSlot: async () => {
        reservationCount++;
        if (reservationCount > maxReservations) {
          reservationCount--;
          return { ok: false, used: maxReservations };
        }
        const batchId = `batch_${id}`;
        return {
          ok: true,
          batchId,
        };
      },
      releaseSlot: async () => {
        reservationCount--;
      },
      limit: maxReservations,
    });
  };

  const results = await Promise.all([
    generateDraftBatch(createPortsWithCounter(1), { variants: 1 }),
    generateDraftBatch(createPortsWithCounter(2), { variants: 1 }),
    generateDraftBatch(createPortsWithCounter(3), { variants: 1 }),
    generateDraftBatch(createPortsWithCounter(4), { variants: 1 }),
  ]);

  // At most maxReservations should succeed; rest should hit the limit
  const successCount = results.filter((r) => r.status === 201).length;
  const limitCount = results.filter((r) => r.status === 429).length;

  assert.ok(successCount <= maxReservations);
  assert.strictEqual(limitCount, 4 - maxReservations, "Remaining calls should hit limit");
});

test("multiple drafts are all inserted and returned", async () => {
  const ports = createMockPorts({
    parse: () => ({
      drafts: [{ text: "Draft 1" }, { text: "Draft 2" }, { text: "Draft 3" }],
      errors: [],
    }),
  });

  const result = await generateDraftBatch(ports, { variants: 3 });

  assert.strictEqual(result.status, 201);
  const drafts = (result.body as any).drafts;
  assert.strictEqual(drafts.length, 3);
  assert.deepStrictEqual(drafts[0], {
    text: "Draft 1",
    id: "id_0",
    batchId: "batch_123",
  });
  assert.deepStrictEqual(drafts[2], {
    text: "Draft 3",
    id: "id_2",
    batchId: "batch_123",
  });
});

test("parse errors are included in 502 response", async () => {
  const ports = createMockPorts({
    parse: () => ({
      drafts: [],
      errors: [
        "Error 1",
        "Error 2",
        "Error 3",
        "Error 4",
      ],
    }),
  });

  const result = await generateDraftBatch(ports, { variants: 1 });

  assert.strictEqual(result.status, 502);
  const details = (result.body as any).details;
  assert.ok(Array.isArray(details));
  assert.strictEqual(details.length, 3, "Only first 3 errors");
});

test("released slot only on failure before insert", async () => {
  let releaseCount = 0;

  const ports = createMockPorts({
    releaseSlot: async () => {
      releaseCount++;
    },
  });

  // Successful case should not call releaseSlot
  await generateDraftBatch(ports, { variants: 1 });
  assert.strictEqual(releaseCount, 0);

  // Reset
  releaseCount = 0;

  // Failed model case should call releaseSlot once
  const ports2 = createMockPorts({
    callModel: async () => {
      throw new Error("Model failed");
    },
    releaseSlot: async () => {
      releaseCount++;
    },
  });

  await generateDraftBatch(ports2, { variants: 1 });
  assert.strictEqual(releaseCount, 1);
});
