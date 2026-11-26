import assert from "node:assert/strict";
import { test } from "vitest";
import { deploymentReview } from "../src/adapters/deployment-review.ts";
import { StateStore } from "../src/db.ts";
import type { AdapterEmit, Delivery } from "../src/types.ts";
import { FakeGitHub, emitFor } from "./helpers.ts";

const repo = "acme/app";
const pending = (runId: number) => `/repos/${repo}/actions/runs/${runId}/pending_deployments`;

function deployment(patch: Record<string, unknown> = {}) {
  return {
    environment: { id: 3, name: "production" },
    state: "pending",
    comment: "ship it",
    ...patch,
  };
}

function context(
  db: StateStore,
  gh: FakeGitHub,
  state: { deliveries: Delivery[]; emit: AdapterEmit },
) {
  return { repo, refs: [], db, durations: db.durations, gh, emit: state.emit };
}

function seedRun(db: StateStore, id: number, status = "in_progress"): void {
  db.putSnapshot(repo, "workflow_run", String(id), status, { id, status, name: "Deploy" });
}

test("a deployment waiting for approval is requested once", async () => {
  const db = new StateStore(":memory:");
  seedRun(db, 5);
  const gh = new FakeGitHub({ [pending(5)]: { pending_deployments: [deployment()] } });
  const state = emitFor(db, repo);
  const ctx = context(db, gh, state);

  await deploymentReview.poll(ctx);
  assert.equal(state.deliveries.length, 1);
  assert.equal(state.deliveries[0]!.action, "requested");
  assert.equal(state.deliveries[0]!.key, "5:3");

  await deploymentReview.poll(ctx);
  assert.equal(state.deliveries.length, 1);
  db.close();
});

test("an approval leaves the list without inventing an approved action", async () => {
  const db = new StateStore(":memory:");
  seedRun(db, 5);
  const gh = new FakeGitHub({ [pending(5)]: { pending_deployments: [deployment()] } });
  const state = emitFor(db, repo);
  const ctx = context(db, gh, state);
  await deploymentReview.poll(ctx);

  gh.respond(pending(5), { pending_deployments: [] });
  await deploymentReview.poll(ctx);

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["requested"],
  );
  db.close();
});

test("a finished run is not polled for pending deployments", async () => {
  const db = new StateStore(":memory:");
  seedRun(db, 5, "completed");
  const gh = new FakeGitHub({});
  const state = emitFor(db, repo);

  await deploymentReview.poll(context(db, gh, state));

  assert.equal(state.deliveries.length, 0);
  db.close();
});
