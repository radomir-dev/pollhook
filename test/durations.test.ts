import assert from "node:assert/strict";
import test from "node:test";
import { StateStore } from "../src/db.ts";

test("a workflow reports no typical duration below three samples", () => {
  const db = new StateStore(":memory:");
  db.durations.record("acme/app", "r1", "1", 60_000);
  db.durations.record("acme/app", "r2", "1", 90_000);

  assert.equal(db.durations.typical("acme/app", "1"), null);
  db.close();
});

test("the typical duration is the median of the recent samples", () => {
  const db = new StateStore(":memory:");
  [60_000, 90_000, 1_000_000, 90_000].forEach((ms, index) => {
    db.durations.record("acme/app", `r${index}`, "1", ms);
  });

  assert.deepEqual(db.durations.typical("acme/app", "1"), { typicalMs: 90_000, samples: 4 });
  db.close();
});

test("samples are kept per workflow and per repository", () => {
  const db = new StateStore(":memory:");
  for (let index = 0; index < 3; index += 1) db.durations.record("acme/app", `f${index}`, "fast", 10_000);
  for (let index = 0; index < 3; index += 1) db.durations.record("acme/app", `s${index}`, "slow", 600_000);
  for (let index = 0; index < 3; index += 1) db.durations.record("acme/lib", `l${index}`, "fast", 30_000);

  assert.equal(db.durations.typical("acme/app", "fast")?.typicalMs, 10_000);
  assert.equal(db.durations.typical("acme/app", "slow")?.typicalMs, 600_000);
  assert.equal(db.durations.typical("acme/lib", "fast")?.typicalMs, 30_000);
  db.close();
});

test("only the newest twenty samples count", () => {
  const db = new StateStore(":memory:");
  db.durations.record("acme/app", "old", "1", 1_000);
  for (let index = 0; index < 20; index += 1) db.durations.record("acme/app", `r${index}`, "1", 120_000);

  const typical = db.durations.typical("acme/app", "1");
  assert.equal(typical?.samples, 20);
  assert.equal(typical?.typicalMs, 120_000);
  db.close();
});

test("the same run is recorded once, however often the list is polled", () => {
  const db = new StateStore(":memory:");
  for (let index = 0; index < 3; index += 1) db.durations.record("acme/app", "r1", "1", 120_000);
  db.durations.record("acme/app", "r2", "1", 60_000);
  db.durations.record("acme/app", "r3", "1", 60_000);

  assert.deepEqual(db.durations.typical("acme/app", "1"), { typicalMs: 60_000, samples: 3 });
  db.close();
});
