import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { workflowRun } from "../src/adapters/workflow-run.ts";
import { StateStore } from "../src/db.ts";
import { emitFor, FakeGitHub, tempStateDir } from "./helpers.ts";

const RUNS_PATH = "/repos/acme/app/actions/runs?per_page=50";

function run(status: string, conclusion: string | null = null) {
  return {
    id: 7,
    name: "CI",
    run_attempt: 1,
    status,
    conclusion,
    head_sha: "abc123",
    html_url: "https://github.com/acme/app/actions/runs/7",
    pull_requests: [],
  };
}

function githubWith(runs: unknown[]) {
  return new FakeGitHub({ [RUNS_PATH]: { total_count: runs.length, workflow_runs: runs } });
}

test("a run emits once per state transition", async () => {
  const db = new StateStore(":memory:");
  const state = emitFor(db, "acme/app");
  const gh = githubWith([run("in_progress")]);

  await workflowRun.poll({
    repo: "acme/app",
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });
  assert.equal(state.deliveries.length, 1);
  assert.equal(state.deliveries[0]!.action, "in_progress");

  await workflowRun.poll({
    repo: "acme/app",
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });
  assert.equal(state.deliveries.length, 1, "an unchanged poll emits nothing");

  gh.respond(RUNS_PATH, { workflow_runs: [run("completed", "success")] });
  await workflowRun.poll({
    repo: "acme/app",
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });
  assert.equal(state.deliveries.length, 2);
  assert.equal(state.deliveries[1]!.action, "completed");
  assert.equal(
    (state.deliveries[1]!.payload.workflow_run as { conclusion: string }).conclusion,
    "success",
  );
  db.close();
});

test("a 304 emits nothing and keeps the snapshot", async () => {
  const db = new StateStore(":memory:");
  const state = emitFor(db, "acme/app");
  const gh = githubWith([run("completed", "success")]);
  await workflowRun.poll({
    repo: "acme/app",
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });
  gh.respond(RUNS_PATH, null);
  await workflowRun.poll({
    repo: "acme/app",
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });
  assert.equal(state.deliveries.length, 1);
  db.close();
});

test("a restart does not redeliver an observed state", async () => {
  const path = join(tempStateDir(), "state.db");
  const gh = githubWith([run("completed", "success")]);

  const first = new StateStore(path);
  const before = emitFor(first, "acme/app");
  await workflowRun.poll({
    repo: "acme/app",
    refs: [],
    db: first,
    durations: first.durations,
    gh,
    emit: before.emit,
  });
  first.close();
  assert.equal(before.deliveries.length, 1);

  const second = new StateStore(path);
  const after = emitFor(second, "acme/app");
  await workflowRun.poll({
    repo: "acme/app",
    refs: [],
    db: second,
    durations: second.durations,
    gh,
    emit: after.emit,
  });
  second.close();
  assert.equal(after.deliveries.length, 0);
});

test("a run finished before the first poll still emits completed", async () => {
  const db = new StateStore(":memory:");
  const state = emitFor(db, "acme/app");
  const gh = githubWith([run("completed", "failure")]);
  await workflowRun.poll({
    repo: "acme/app",
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });
  assert.equal(state.deliveries.length, 1);
  assert.equal(state.deliveries[0]!.action, "completed");
  db.close();
});
