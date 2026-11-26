import assert from "node:assert/strict";
import { test } from "vitest";
import { issueDependencies } from "../src/adapters/issue-dependencies.ts";
import { StateStore } from "../src/db.ts";
import { emitFor, FakeGitHub } from "./helpers.ts";

const repo = "acme/app";
const ISSUES = "/repos/acme/app/issues?state=all&sort=updated&direction=desc&per_page=100";
const BLOCKED_BY = "/repos/acme/app/issues/3/dependencies/blocked_by?per_page=100";

const issue = (totalBlockedBy: number, overrides: Record<string, unknown> = {}) => ({
  id: 300,
  number: 3,
  updated_at: "t1",
  issue_dependencies_summary: { total_blocked_by: totalBlockedBy },
  ...overrides,
});
const blocker = (id: number, repository = "acme/app") => ({
  id,
  number: id - 100,
  repository_url: `https://api.github.com/repos/${repository}`,
});

function setup(responses: Record<string, unknown>) {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub(responses);
  const state = emitFor(db, repo);
  const poll = () =>
    issueDependencies.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });
  return { db, gh, state, poll };
}

test("a new blocker emits blocked_by_added with both issues", async () => {
  const { db, gh, state, poll } = setup({ [ISSUES]: [issue(0)] });
  await poll();
  gh.respond(ISSUES, [issue(1)]);
  gh.respond(BLOCKED_BY, [blocker(101)]);
  await poll();

  assert.equal(state.deliveries.length, 1);
  const delivery = state.deliveries[0]!;
  assert.equal(delivery.action, "blocked_by_added");
  assert.equal(delivery.payload.blocked_issue_id, 300);
  assert.equal(delivery.payload.blocking_issue_id, 101);
  assert.equal((delivery.payload.blocking_issue_repo as { full_name: string }).full_name, repo);
  db.close();
});

test("removing a blocker emits blocked_by_removed, and re-adding it is delivered again", async () => {
  const { db, gh, state, poll } = setup({ [ISSUES]: [issue(1)], [BLOCKED_BY]: [blocker(101)] });
  await poll();
  gh.respond(ISSUES, [issue(0)]);
  gh.respond(BLOCKED_BY, []);
  await poll();
  gh.respond(ISSUES, [issue(1)]);
  gh.respond(BLOCKED_BY, [blocker(101)]);
  await poll();

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["blocked_by_added", "blocked_by_removed", "blocked_by_added"],
  );
  db.close();
});

test("a blocker in another repository is described by its full name", async () => {
  const { db, gh, state, poll } = setup({ [ISSUES]: [issue(0)] });
  await poll();
  gh.respond(ISSUES, [issue(1)]);
  gh.respond(BLOCKED_BY, [blocker(101, "acme/other")]);
  await poll();

  const repository = state.deliveries[0]!.payload.blocking_issue_repo as { full_name: string };
  assert.equal(repository.full_name, "acme/other");
  db.close();
});

test("an unchanged count reads no dependencies, and pull requests are ignored", async () => {
  const { db, gh, state, poll } = setup({
    [ISSUES]: [issue(0), issue(2, { number: 4, pull_request: { url: "x" } })],
  });
  await poll();
  gh.respond(ISSUES, [issue(0, { updated_at: "t2" }), issue(2, { number: 4, pull_request: {} })]);
  await poll();

  assert.equal(state.deliveries.length, 0);
  db.close();
});
