import assert from "node:assert/strict";
import test from "node:test";
import { createRef, deleteRef } from "../src/adapters/refs.ts";
import { StateStore } from "../src/db.ts";
import { emitFor, FakeGitHub } from "./helpers.ts";

const repo = "acme/app";
const BRANCHES = "/repos/acme/app/branches?per_page=100";
const TAGS = "/repos/acme/app/tags?per_page=100";

function github(branches: Array<[string, string]>, tags: Array<[string, string]> = []) {
  return new FakeGitHub({
    [BRANCHES]: branches.map(([name, sha]) => ({ name, commit: { sha } })),
    [TAGS]: tags.map(([name, sha]) => ({ name, commit: { sha } })),
  });
}

function seed(db: StateStore, type: "branch" | "tag", name: string, sha: string) {
  db.putSnapshot(repo, "refs", `${type}:${name}`, sha, { type, name });
}

test("create emits for a branch that was not stored", async () => {
  const db = new StateStore(":memory:");
  seed(db, "branch", "main", "aaa");
  const gh = github([
    ["main", "aaa"],
    ["feature", "fff"],
  ]);
  const state = emitFor(db, repo);
  await createRef.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });

  assert.equal(state.deliveries.length, 1);
  const payload = state.deliveries[0]!.payload;
  assert.equal(payload.ref, "refs/heads/feature");
  assert.equal(payload.ref_type, "branch");
  assert.equal(payload.master_branch, "main");
  db.close();
});

test("a moved tag is not a create", async () => {
  const db = new StateStore(":memory:");
  seed(db, "tag", "v1", "t1");
  const gh = github([], [["v1", "t2"]]);
  const state = emitFor(db, repo);
  await createRef.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });

  assert.equal(state.deliveries.length, 0);
  assert.equal(db.getSnapshot(repo, "refs", "tag:v1")?.state, "t2");
  db.close();
});

test("a re-created ref emits create again", async () => {
  const db = new StateStore(":memory:");
  seed(db, "branch", "feature", "deleted");
  const gh = github([["feature", "fff"]]);
  const state = emitFor(db, repo);
  await createRef.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });

  assert.equal(state.deliveries.length, 1);
  assert.equal(state.deliveries[0]!.payload.ref, "refs/heads/feature");
  db.close();
});

test("delete emits once for a missing branch", async () => {
  const db = new StateStore(":memory:");
  seed(db, "branch", "main", "aaa");
  seed(db, "branch", "feature", "fff");
  const gh = github([["main", "aaa"]]);
  const state = emitFor(db, repo);

  await deleteRef.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });
  assert.equal(state.deliveries.length, 1);
  assert.equal(state.deliveries[0]!.payload.ref, "refs/heads/feature");
  assert.equal(state.deliveries[0]!.payload.ref_type, "branch");
  assert.equal(db.getSnapshot(repo, "refs", "branch:feature")?.state, "deleted");

  await deleteRef.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });
  assert.equal(state.deliveries.length, 1);
  db.close();
});

test("delete emits for a removed tag", async () => {
  const db = new StateStore(":memory:");
  seed(db, "tag", "v1", "t1");
  const gh = github([]);
  const state = emitFor(db, repo);
  await deleteRef.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });

  assert.equal(state.deliveries.length, 1);
  assert.equal(state.deliveries[0]!.payload.ref, "refs/tags/v1");
  db.close();
});
