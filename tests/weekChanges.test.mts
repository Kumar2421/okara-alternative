import { test } from "node:test";
import * as assert from "node:assert";
import { weekChanges, eventsFromChanges } from "../lib/domain/search/weekChanges.ts";
import { compareWindows } from "../lib/domain/search/searchDelta.ts";
import type { SnapshotWindow } from "../lib/domain/search/searchSnapshot.ts";

test("weekChanges - converts search deltas to events", () => {
  const current: SnapshotWindow = {
    startDate: "2024-01-08",
    endDate: "2024-01-14",
    queries: [
      { query: "established search", clicks: 50, impressions: 1000, ctr: 0.05, position: 2 },
      { query: "new this week", clicks: 5, impressions: 100, ctr: 0.05, position: 5 },
    ],
  };

  const previous: SnapshotWindow = {
    startDate: "2024-01-01",
    endDate: "2024-01-07",
    queries: [
      { query: "established search", clicks: 45, impressions: 900, ctr: 0.05, position: 3 },
    ],
  };

  const events = weekChanges(current, previous, 5);

  assert.ok(events.length > 0, "should return events");
  assert.ok(events.some((e) => e.type === "appeared"), "should detect new searches");
});

test("weekChanges - handles null windows", () => {
  const events = weekChanges(null, null, 5);
  assert.strictEqual(events.length, 0, "should return empty array for null windows");
});

test("weekChanges - respects limit", () => {
  const current: SnapshotWindow = {
    startDate: "2024-01-08",
    endDate: "2024-01-14",
    queries: [
      { query: "search 1", clicks: 5, impressions: 100, ctr: 0.05, position: 1 },
      { query: "search 2", clicks: 5, impressions: 100, ctr: 0.05, position: 2 },
      { query: "search 3", clicks: 5, impressions: 100, ctr: 0.05, position: 3 },
    ],
  };

  const previous: SnapshotWindow = {
    startDate: "2024-01-01",
    endDate: "2024-01-07",
    queries: [],
  };

  const events = weekChanges(current, previous, 2);
  assert.strictEqual(events.length, 2, "should respect limit");
});

test("weekChanges - uses plain language for event types", () => {
  const current: SnapshotWindow = {
    startDate: "2024-01-08",
    endDate: "2024-01-14",
    queries: [
      { query: "improved search", clicks: 100, impressions: 1000, ctr: 0.1, position: 1 },
      { query: "declining search", clicks: 25, impressions: 500, ctr: 0.05, position: 5 },
    ],
  };

  const previous: SnapshotWindow = {
    startDate: "2024-01-01",
    endDate: "2024-01-07",
    queries: [
      { query: "improved search", clicks: 80, impressions: 800, ctr: 0.1, position: 4 }, // 3 position improvement
      { query: "declining search", clicks: 50, impressions: 500, ctr: 0.1, position: 2 }, // 3 position decline
    ],
  };

  const events = weekChanges(current, previous, 5);

  assert.ok(events.some((e) => e.type === "improved" && e.query === "improved search"), "should detect improved rankings");
  assert.ok(events.some((e) => e.type === "declined" && e.query === "declining search"), "should detect declining rankings");
});

test("weekChanges - event details are plain language", () => {
  const current: SnapshotWindow = {
    startDate: "2024-01-08",
    endDate: "2024-01-14",
    queries: [
      { query: "new search", clicks: 5, impressions: 100, ctr: 0.05, position: 5 },
    ],
  };

  const previous: SnapshotWindow = {
    startDate: "2024-01-01",
    endDate: "2024-01-07",
    queries: [],
  };

  const events = weekChanges(current, previous, 5);
  const appeared = events.find((e) => e.type === "appeared");

  assert.ok(appeared, "should have appeared event");
  assert.ok(appeared!.detail.includes("views"), "detail should use plain language");
  assert.ok(!appeared!.detail.match(/\d{1,3}views/i) || appeared!.detail.includes("100"), "detail should have formatted number");
});

test("eventsFromChanges - converts real delta QueryChange objects", () => {
  const current: SnapshotWindow = {
    startDate: "2024-01-08",
    endDate: "2024-01-14",
    queries: [
      { query: "improved query", clicks: 100, impressions: 1000, ctr: 0.1, position: 1 },
      { query: "new query", clicks: 5, impressions: 100, ctr: 0.05, position: 5 },
    ],
  };

  const previous: SnapshotWindow = {
    startDate: "2024-01-01",
    endDate: "2024-01-07",
    queries: [
      { query: "improved query", clicks: 80, impressions: 800, ctr: 0.1, position: 4 },
      { query: "declining query", clicks: 50, impressions: 500, ctr: 0.1, position: 2 },
    ],
  };

  const changes = compareWindows(current.queries, previous.queries);
  const events = eventsFromChanges(changes, 10);

  assert.ok(events.some((e) => e.type === "improved"), "should convert improved trends");
  assert.ok(events.some((e) => e.type === "appeared"), "should convert new trends");
  assert.ok(events.some((e) => e.type === "disappeared"), "should convert lost trends");
});
