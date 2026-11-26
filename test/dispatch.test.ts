import assert from "node:assert/strict";
import { test } from "vitest";
import { mergeGroup, workflowDispatch } from "../src/adapters/dispatch.ts";
import { StateStore } from "../src/db.ts";
import { emitFor, FakeGitHub } from "./helpers.ts";

const repo = "acme/app";
const DISPATCH = "/repos/acme/app/actions/runs?event=workflow_dispatch&per_page=30";
const MERGE = "/repos/acme/app/actions/runs?event=merge_group&per_page=30";

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    run_attempt: 1,
    event: "workflow_dispatch",
    status: "in_progress",
    conclusion: null,
    head_sha: "abc",
    head_branch: "main",
    html_url: "",
    ...overrides,
  };
}

test("workflow_dispatch emits once per run, not per status change", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [DISPATCH]: { workflow_runs: [run()] } });
  const state = emitFor(db, repo);

  await workflowDispatch.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });
  assert.equal(state.deliveries.length, 1);
  assert.equal((state.deliveries[0]!.payload.workflow_run as { id: number }).id, 1);

  gh.respond(DISPATCH, { workflow_runs: [run({ status: "completed", conclusion: "success" })] });
  await workflowDispatch.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });
  assert.equal(state.deliveries.length, 1);

  gh.respond(DISPATCH, {
    workflow_runs: [run(), run({ id: 2, status: "queued" })],
  });
  await workflowDispatch.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });
  assert.equal(state.deliveries.length, 2);
  db.close();
});

test("merge_group emits checks_requested with the head it saw", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({
    [MERGE]: {
      workflow_runs: [
        run({
          id: 9,
          event: "merge_group",
          head_sha: "fff",
          head_branch: "gh-readonly-queue/main",
        }),
      ],
    },
  });
  const state = emitFor(db, repo);
  await mergeGroup.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });

  assert.equal(state.deliveries.length, 1);
  assert.equal(state.deliveries[0]!.action, "checks_requested");
  const group = state.deliveries[0]!.payload.merge_group as { head_sha: string; head_ref: string };
  assert.equal(group.head_sha, "fff");
  assert.equal(group.head_ref, "gh-readonly-queue/main");
  db.close();
});

test("runs for another event are filtered out", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [DISPATCH]: { workflow_runs: [run({ event: "push" })] } });
  const state = emitFor(db, repo);
  await workflowDispatch.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });
  assert.equal(state.deliveries.length, 0);
  db.close();
});
