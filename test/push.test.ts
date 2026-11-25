import assert from "node:assert/strict";
import test from "node:test";
import { push } from "../src/adapters/push.ts";
import { StateStore } from "../src/db.ts";
import { emitFor, FakeGitHub } from "./helpers.ts";

const repo = "acme/app";
const BRANCHES = "/repos/acme/app/branches?per_page=100";

function branches(name: string, sha: string) {
  return [{ name, commit: { sha } }];
}

function compare(before: string, after: string, status = "ahead") {
  return {
    status,
    html_url: `https://github.com/acme/app/compare/${before}...${after}`,
    commits: [{ id: "c1" }, { id: "c2" }],
  };
}

test("a moved branch emits a push assembled from compare", async () => {
  const db = new StateStore(":memory:");
  db.putSnapshot(repo, "push", "main", "aaa", { name: "main", sha: "aaa" });
  const gh = new FakeGitHub({
    [BRANCHES]: branches("main", "bbb"),
    [`/repos/acme/app/compare/aaa...bbb`]: compare("aaa", "bbb"),
  });
  const state = emitFor(db, repo);
  await push.poll({ repo, refs: [], db, gh, emit: state.emit });

  assert.equal(state.deliveries.length, 1);
  const payload = state.deliveries[0]!.payload;
  assert.equal(payload.ref, "refs/heads/main");
  assert.equal(payload.before, "aaa");
  assert.equal(payload.after, "bbb");
  assert.equal(payload.created, false);
  assert.equal(payload.forced, false);
  assert.equal((payload.head_commit as { id: string }).id, "c2");
  db.close();
});

test("a diverged compare marks the push as forced", async () => {
  const db = new StateStore(":memory:");
  db.putSnapshot(repo, "push", "main", "aaa", { name: "main", sha: "aaa" });
  const gh = new FakeGitHub({
    [BRANCHES]: branches("main", "bbb"),
    [`/repos/acme/app/compare/aaa...bbb`]: compare("aaa", "bbb", "diverged"),
  });
  const state = emitFor(db, repo);
  await push.poll({ repo, refs: [], db, gh, emit: state.emit });
  assert.equal(state.deliveries[0]!.payload.forced, true);
  db.close();
});

test("an unchanged tip emits nothing", async () => {
  const db = new StateStore(":memory:");
  db.putSnapshot(repo, "push", "main", "aaa", { name: "main", sha: "aaa" });
  const gh = new FakeGitHub({ [BRANCHES]: branches("main", "aaa") });
  const state = emitFor(db, repo);
  await push.poll({ repo, refs: [], db, gh, emit: state.emit });
  assert.equal(state.deliveries.length, 0);
  db.close();
});

test("a branch first seen after priming is reported as created", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({
    [BRANCHES]: branches("feature", "fff"),
    [`/repos/acme/app/commits?sha=feature&per_page=20`]: [{ id: "f1" }],
  });
  const state = emitFor(db, repo);
  await push.poll({ repo, refs: [], db, gh, emit: state.emit });

  const payload = state.deliveries[0]!.payload;
  assert.equal(payload.created, true);
  assert.equal(payload.before, "0".repeat(40));
  assert.equal((payload.head_commit as { id: string }).id, "f1");
  db.close();
});

test("a failed compare advances the snapshot without delivering or retrying", async () => {
  const db = new StateStore(":memory:");
  db.putSnapshot(repo, "push", "main", "aaa", { name: "main", sha: "aaa" });
  const gh = new FakeGitHub({ [BRANCHES]: branches("main", "bbb") });
  const state = emitFor(db, repo);

  await push.poll({ repo, refs: [], db, gh, emit: state.emit });
  assert.equal(state.deliveries.length, 0);
  assert.equal(db.getSnapshot(repo, "push", "main")?.state, "bbb");

  await push.poll({ repo, refs: [], db, gh, emit: state.emit });
  assert.equal(state.deliveries.length, 0);
  db.close();
});
