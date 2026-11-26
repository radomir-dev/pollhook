import assert from "node:assert/strict";
import { test } from "vitest";
import { workflowJob } from "../src/adapters/workflow-job.ts";
import { StateStore } from "../src/db.ts";
import type { AdapterEmit, Delivery } from "../src/types.ts";
import { FakeGitHub, emitFor } from "./helpers.ts";

const repo = "acme/app";
const jobs = (id: number) => `/repos/${repo}/actions/runs/${id}/jobs?per_page=100`;

function job(patch: Record<string, unknown> = {}) {
  return {
    id: 90,
    run_id: 5,
    run_attempt: 1,
    name: "build",
    status: "in_progress",
    conclusion: null,
    completed_at: null,
    ...patch,
  };
}

function seedRun(db: StateStore, status: string): void {
  db.putSnapshot(repo, "workflow_run", "5", status, { id: 5, status });
}

function context(
  db: StateStore,
  gh: FakeGitHub,
  state: { deliveries: Delivery[]; emit: AdapterEmit },
) {
  return { repo, refs: [], db, durations: db.durations, gh, emit: state.emit };
}

test("a job appears when its run starts and completes once the job finishes", async () => {
  const db = new StateStore(":memory:");
  seedRun(db, "in_progress");
  const gh = new FakeGitHub({ [jobs(5)]: { jobs: [job()] } });
  const state = emitFor(db, repo);

  await workflowJob.poll(context(db, gh, state));
  assert.equal(state.deliveries.length, 1);
  assert.equal(state.deliveries[0]!.action, "in_progress");
  assert.equal(state.deliveries[0]!.key, "90");

  gh.respond(jobs(5), {
    jobs: [
      job({ status: "completed", conclusion: "failure", completed_at: "2026-11-25T21:00:00Z" }),
    ],
  });
  await workflowJob.poll(context(db, gh, state));

  assert.equal(state.deliveries.length, 2);
  assert.equal(state.deliveries[1]!.action, "completed");
  assert.equal((state.deliveries[1]!.payload.workflow_job as any).conclusion, "failure");
  db.close();
});

test("a queued job is reported as queued, not as created", async () => {
  const db = new StateStore(":memory:");
  seedRun(db, "queued");
  const gh = new FakeGitHub({ [jobs(5)]: { jobs: [job({ status: "queued" })] } });
  const state = emitFor(db, repo);

  await workflowJob.poll(context(db, gh, state));

  assert.equal(state.deliveries[0]!.action, "queued");
  db.close();
});

test("no jobs are fetched when no run is active", async () => {
  const db = new StateStore(":memory:");
  seedRun(db, "completed");
  const gh = new FakeGitHub({});
  const state = emitFor(db, repo);

  await workflowJob.poll(context(db, gh, state));

  assert.equal(state.deliveries.length, 0);
  db.close();
});

test("an unchanged job does not deliver again", async () => {
  const db = new StateStore(":memory:");
  seedRun(db, "in_progress");
  const gh = new FakeGitHub({ [jobs(5)]: { jobs: [job()] } });
  const state = emitFor(db, repo);

  await workflowJob.poll(context(db, gh, state));
  await workflowJob.poll(context(db, gh, state));

  assert.equal(state.deliveries.length, 1);
  db.close();
});
