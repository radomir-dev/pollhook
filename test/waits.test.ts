import assert from "node:assert/strict";
import test from "node:test";
import { StateStore } from "../src/db.ts";
import { resolveWait } from "../src/waits.ts";

const repo = "acme/app";

function dbWithRun(status: string, conclusion: string | null) {
  const db = new StateStore(":memory:");
  db.putSnapshot(repo, "workflow_run", "7", `${status}:${conclusion}`, {
    name: "CI",
    status,
    conclusion,
    head_sha: "abc",
    html_url: "https://github.com/acme/app/actions/runs/7",
  });
  return db;
}

test("run: a completed run resolves immediately with its conclusion", () => {
  const success = resolveWait(dbWithRun("completed", "success"), { kind: "run", repo, id: "7" });
  assert.equal(success?.exitCode, 0);
  assert.equal(success?.body.name, "CI");

  const failure = resolveWait(dbWithRun("completed", "failure"), { kind: "run", repo, id: "7" });
  assert.equal(failure?.exitCode, 1);

  const running = resolveWait(dbWithRun("in_progress", null), { kind: "run", repo, id: "7" });
  assert.equal(running, null);
});

test("checks: waits for every check on the head, then reports failures", () => {
  const db = new StateStore(":memory:");
  db.putSnapshot(repo, "pull_request", "5", "open", { state: "open", head: { sha: "abc" } });
  db.putSnapshot(repo, "check_run", "1", "completed:failure", {
    head_sha: "abc",
    status: "completed",
    conclusion: "failure",
    name: "unit",
  });
  db.putSnapshot(repo, "check_run", "2", "completed:success", {
    head_sha: "abc",
    status: "completed",
    conclusion: "success",
    name: "lint",
  });

  const failing = resolveWait(db, { kind: "checks", repo, pr: 5 });
  assert.equal(failing?.exitCode, 1);
  assert.deepEqual(failing?.body.failing, ["unit"]);
  assert.equal(failing?.body.total, 2);

  db.putSnapshot(repo, "check_run", "1", "completed:success", {
    head_sha: "abc",
    status: "completed",
    conclusion: "success",
    name: "unit",
  });
  const passing = resolveWait(db, { kind: "checks", repo, pr: 5 });
  assert.equal(passing?.exitCode, 0);
  assert.deepEqual(passing?.body.failing, []);
});

test("checks: incomplete checks and a fresh head keep the wait open", () => {
  const db = new StateStore(":memory:");
  db.putSnapshot(repo, "pull_request", "5", "open", { state: "open", head: { sha: "abc" } });
  db.putSnapshot(repo, "check_run", "1", "in_progress:null", {
    head_sha: "abc",
    status: "in_progress",
    conclusion: null,
    name: "unit",
  });
  assert.equal(resolveWait(db, { kind: "checks", repo, pr: 5 }), null);

  db.putSnapshot(repo, "pull_request", "5", "open:def", { state: "open", head: { sha: "def" } });
  assert.equal(resolveWait(db, { kind: "checks", repo, pr: 5 }), null);

  const oldHead = resolveWait(db, {
    kind: "checks",
    repo,
    pr: 5,
    initialHead: "abc",
  });
  assert.equal(oldHead, null, "no checks yet for the new head");
});

test("checks: reports that the head changed while waiting", () => {
  const db = new StateStore(":memory:");
  db.putSnapshot(repo, "pull_request", "5", "open", { state: "open", head: { sha: "def" } });
  db.putSnapshot(repo, "check_run", "9", "completed:success", {
    head_sha: "def",
    status: "completed",
    conclusion: "success",
    name: "unit",
  });
  const outcome = resolveWait(db, { kind: "checks", repo, pr: 5, initialHead: "abc" });
  assert.equal(outcome?.body.restarted, true);
});

test("pr: merged, closed and conflict are distinct targets", () => {
  const db = new StateStore(":memory:");
  db.putSnapshot(repo, "pull_request", "5", "closed:true", {
    state: "closed",
    merged: true,
    mergeable: null,
  });
  assert.equal(resolveWait(db, { kind: "pr", repo, pr: 5, until: "merged" })?.exitCode, 0);
  assert.equal(resolveWait(db, { kind: "pr", repo, pr: 5, until: "closed" })?.exitCode, 0);

  db.putSnapshot(repo, "pull_request", "5", "closed:false", {
    state: "closed",
    merged: false,
    mergeable: null,
  });
  assert.equal(resolveWait(db, { kind: "pr", repo, pr: 5, until: "merged" })?.exitCode, 1);

  db.putSnapshot(repo, "pull_request", "5", "open:false", {
    state: "open",
    merged: false,
    mergeable: false,
  });
  assert.equal(resolveWait(db, { kind: "pr", repo, pr: 5, until: "conflict" })?.exitCode, 0);
  assert.equal(resolveWait(db, { kind: "pr", repo, pr: 5, until: "merged" }), null);
});

test("pr: reviewed needs a review that was not dismissed", () => {
  const db = new StateStore(":memory:");
  db.putSnapshot(repo, "pull_request", "5", "open", { state: "open", merged: false });
  db.putSnapshot(repo, "pull_request_review", "5:1", "DISMISSED", { state: "DISMISSED" });
  assert.equal(resolveWait(db, { kind: "pr", repo, pr: 5, until: "reviewed" }), null);
  db.putSnapshot(repo, "pull_request_review", "5:2", "APPROVED", { state: "APPROVED" });
  assert.equal(resolveWait(db, { kind: "pr", repo, pr: 5, until: "reviewed" })?.exitCode, 0);
});

test("pages: waits for the build of that commit", () => {
  const db = new StateStore(":memory:");
  db.putSnapshot(repo, "page_build", "1", "building", { build: { commit: "abc", status: "building" } });
  assert.equal(resolveWait(db, { kind: "pages", repo, sha: "abc" }), null);

  db.putSnapshot(repo, "page_build", "1", "built", { build: { commit: "abc", status: "built" } });
  assert.equal(resolveWait(db, { kind: "pages", repo, sha: "abc" })?.exitCode, 0);

  db.putSnapshot(repo, "page_build", "2", "errored", { build: { commit: "def", status: "errored" } });
  assert.equal(resolveWait(db, { kind: "pages", repo, sha: "def" })?.exitCode, 1);
});

test("event: matches a recent delivery by payload path", () => {
  const db = new StateStore(":memory:");
  db.recordDelivery(repo, "workflow_run", "completed", "7", "s1", {
    action: "completed",
    workflow_run: { conclusion: "success" },
  });
  db.recordDelivery(repo, "workflow_run", "completed", "7", "s2", {
    action: "completed",
    workflow_run: { conclusion: "failure" },
  });
  const hit = resolveWait(db, {
    kind: "event",
    repo,
    event: "workflow_run",
    match: { "workflow_run.conclusion": "failure" },
  });
  assert.equal(hit?.exitCode, 0);
  assert.equal(resolveWait(db, {
    kind: "event",
    repo,
    event: "workflow_run",
    match: { action: "nope" },
  }), null);
});
