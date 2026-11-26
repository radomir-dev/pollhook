import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "vitest";
import { StateStore } from "../src/db.ts";
import { tempStateDir } from "./helpers.ts";

test("recording the same delivery twice yields one row", () => {
  const db = new StateStore(":memory:");
  const first = db.recordDelivery(
    "acme/app",
    "workflow_run",
    "in_progress",
    "1",
    "1:in_progress:null",
    {
      action: "in_progress",
    },
  );
  const duplicate = db.recordDelivery(
    "acme/app",
    "workflow_run",
    "in_progress",
    "1",
    "1:in_progress:null",
    {
      action: "in_progress",
    },
  );
  const completed = db.recordDelivery(
    "acme/app",
    "workflow_run",
    "completed",
    "1",
    "1:completed:success",
    {
      action: "completed",
    },
  );
  assert.ok(first);
  assert.equal(duplicate, null);
  assert.ok(completed);
  assert.equal(db.countDeliveries(), 2);
  db.close();
});

test("snapshots round-trip and list newest first", () => {
  const db = new StateStore(":memory:");
  db.putSnapshot("acme/app", "pull_request", "1", "open", { number: 1 });
  db.putSnapshot("acme/app", "pull_request", "2", "open", { number: 2 });
  assert.deepEqual(db.getSnapshot("acme/app", "pull_request", "1")?.data, { number: 1 });
  const rows = db.listSnapshots("acme/app", "pull_request");
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.key, "2");
  assert.equal(db.getSnapshot("acme/app", "pull_request", "9"), null);
  db.close();
});

test("deliveries survive a reopen and are not re-recorded", () => {
  const dir = tempStateDir();
  const path = join(dir, "state.db");
  const state = "1:completed:success";
  const first = new StateStore(path);
  assert.ok(
    first.recordDelivery("acme/app", "workflow_run", "completed", "7", state, {
      action: "completed",
    }),
  );
  first.close();

  const second = new StateStore(path);
  const repeated = second.recordDelivery("acme/app", "workflow_run", "completed", "7", state, {
    action: "completed",
  });
  assert.equal(repeated, null);
  assert.equal(second.countDeliveries(), 1);
  second.close();
});
