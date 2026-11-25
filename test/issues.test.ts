import assert from "node:assert/strict";
import test from "node:test";
import { issueComment } from "../src/adapters/issue-comment.ts";
import { issues } from "../src/adapters/issues.ts";
import { StateStore } from "../src/db.ts";
import { emitFor, FakeGitHub } from "./helpers.ts";

const repo = "acme/app";
const ISSUES = "/repos/acme/app/issues?state=all&sort=updated&direction=desc&per_page=100";
const COMMENTS = "/repos/acme/app/issues/comments?sort=updated&direction=desc&per_page=100";

function issue(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    state: "open",
    title: "Bug",
    body: "body",
    labels: [],
    updated_at: "t1",
    ...overrides,
  };
}

test("a new issue emits opened", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [ISSUES]: [issue()] });
  const state = emitFor(db, repo);
  await issues.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });

  assert.equal(state.deliveries.length, 1);
  assert.equal(state.deliveries[0]!.action, "opened");
  assert.equal((state.deliveries[0]!.payload.issue as { number: number }).number, 1);
  db.close();
});

test("closing an issue emits closed, and a label change emits labeled", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [ISSUES]: [issue()] });
  const state = emitFor(db, repo);
  await issues.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });

  gh.respond(ISSUES, [issue({ state: "closed" })]);
  await issues.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });
  assert.equal(state.deliveries.at(-1)!.action, "closed");

  gh.respond(ISSUES, [issue({ state: "closed", labels: [{ name: "bug" }] })]);
  await issues.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });
  assert.equal(state.deliveries.at(-1)!.action, "labeled");
  assert.equal(state.deliveries.length, 3);
  db.close();
});

test("an issue body edit emits edited", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [ISSUES]: [issue()] });
  const state = emitFor(db, repo);
  await issues.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });

  gh.respond(ISSUES, [issue({ body: "new body" })]);
  await issues.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });
  assert.equal(state.deliveries.at(-1)!.action, "edited");
  db.close();
});

test("pull requests in the issues list are ignored", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({
    [ISSUES]: [issue({ pull_request: { url: "https://api.github.com/repos/acme/app/pulls/1" } })],
  });
  const state = emitFor(db, repo);
  await issues.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });
  assert.equal(state.deliveries.length, 0);
  db.close();
});

test("a comment emits created, then edited, and carries its issue", async () => {
  const db = new StateStore(":memory:");
  db.putSnapshot(repo, "issues", "1", "s", { number: 1, title: "Bug" });
  const gh = new FakeGitHub({
    [COMMENTS]: [
      {
        id: 10,
        body: "hi",
        updated_at: "t1",
        issue_url: "https://api.github.com/repos/acme/app/issues/1",
      },
    ],
  });
  const state = emitFor(db, repo);
  await issueComment.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });

  assert.equal(state.deliveries[0]!.action, "created");
  assert.equal((state.deliveries[0]!.payload.issue as { number: number }).number, 1);

  gh.respond(COMMENTS, [
    {
      id: 10,
      body: "hi there",
      updated_at: "t2",
      issue_url: "https://api.github.com/repos/acme/app/issues/1",
    },
  ]);
  await issueComment.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });
  assert.equal(state.deliveries.at(-1)!.action, "edited");
  assert.equal(state.deliveries.length, 2);
  db.close();
});
