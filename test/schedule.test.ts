import assert from "node:assert/strict";
import test from "node:test";
import { StateStore } from "../src/db.ts";
import { delayFor } from "../src/poller/schedule.ts";
import type { Adapter } from "../src/types.ts";

const adapter = (name: Adapter["name"], floorMs: number): Adapter => ({
  name,
  intervalFloorMs: floorMs,
  poll: async () => {},
});

const repo = "acme/app";
const startedAt = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

function seedRun(db: StateStore, workflowId: string, startedMsAgo: number): void {
  db.putSnapshot(repo, "workflow_run", "1", "state", {
    id: 1,
    workflow_id: workflowId,
    status: "in_progress",
    run_started_at: startedAt(startedMsAgo),
  });
}

test("a workflow still early against its typical duration is polled less often", () => {
  const db = new StateStore(":memory:");
  for (let index = 0; index < 3; index += 1) db.durations.record(repo, `r${index}`, "7", 300_000);
  seedRun(db, "7", 30_000);

  assert.equal(delayFor(adapter("workflow_run", 10_000), 10_000, db, repo), 30_000);
  db.close();
});

test("a workflow past half its typical duration keeps the normal interval", () => {
  const db = new StateStore(":memory:");
  for (let index = 0; index < 3; index += 1) db.durations.record(repo, `r${index}`, "7", 300_000);
  seedRun(db, "7", 200_000);

  assert.equal(delayFor(adapter("workflow_run", 10_000), 10_000, db, repo), 10_000);
  db.close();
});

test("an idle repository keeps the normal interval so a new run is seen quickly", () => {
  const db = new StateStore(":memory:");
  for (let index = 0; index < 3; index += 1) db.durations.record(repo, `r${index}`, "7", 300_000);

  assert.equal(delayFor(adapter("workflow_run", 10_000), 10_000, db, repo), 10_000);
  db.close();
});

test("the slow rule never drops below the adapter floor", () => {
  const db = new StateStore(":memory:");
  for (let index = 0; index < 3; index += 1) db.durations.record(repo, `r${index}`, "7", 600_000);
  seedRun(db, "7", 5_000);

  assert.equal(delayFor(adapter("workflow_run", 120_000), 10_000, db, repo), 120_000);
  db.close();
});

test("other adapters ignore the workflow rule", () => {
  const db = new StateStore(":memory:");
  for (let index = 0; index < 3; index += 1) db.durations.record(repo, `r${index}`, "7", 600_000);
  seedRun(db, "7", 5_000);

  assert.equal(delayFor(adapter("push", 10_000), 10_000, db, repo), 10_000);
  db.close();
});
