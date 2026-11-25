import assert from "node:assert/strict";
import test from "node:test";
import { commitComment } from "../src/adapters/commit-comment.ts";
import { fork } from "../src/adapters/fork.ts";
import { publicEvent, repository } from "../src/adapters/repository.ts";
import { StateStore } from "../src/db.ts";
import { emitFor, FakeGitHub } from "./helpers.ts";

const repo = "acme/app";
const REPO = "/repos/acme/app";
const FORKS = "/repos/acme/app/forks?sort=newest&per_page=100";
const COMMENTS = "/repos/acme/app/comments?sort=updated&direction=desc&per_page=100";

function repoFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    full_name: "acme/app",
    name: "app",
    owner: { login: "acme", id: 2 },
    private: true,
    visibility: "private",
    description: "d",
    default_branch: "main",
    archived: false,
    disabled: false,
    topics: [],
    homepage: null,
    html_url: "",
    ...overrides,
  };
}

test("repository: rename, archive and description edits are derived", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [REPO]: repoFixture() });
  const state = emitFor(db, repo);
  await repository.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });
  assert.equal(state.deliveries.at(-1)!.action, "edited");

  gh.respond(REPO, repoFixture({ full_name: "acme/renamed" }));
  await repository.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });
  assert.equal(state.deliveries.at(-1)!.action, "renamed");

  gh.respond(REPO, repoFixture({ full_name: "acme/renamed", archived: true }));
  await repository.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });
  assert.equal(state.deliveries.at(-1)!.action, "archived");
  db.close();
});

test("public: only the private to public transition emits", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [REPO]: repoFixture() });
  const state = emitFor(db, repo);

  await publicEvent.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });
  assert.equal(state.deliveries.length, 0);

  gh.respond(REPO, repoFixture({ private: false, visibility: "public" }));
  await publicEvent.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });
  assert.equal(state.deliveries.length, 1);
  assert.equal((state.deliveries[0]!.payload.repository as { private: boolean }).private, false);
  db.close();
});

test("fork: each new fork emits once", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [FORKS]: [{ id: 1, created_at: "t1" }] });
  const state = emitFor(db, repo);
  await fork.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });

  gh.respond(FORKS, [
    { id: 1, created_at: "t1" },
    { id: 2, created_at: "t2" },
  ]);
  await fork.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });

  assert.equal(state.deliveries.length, 2);
  assert.equal((state.deliveries[1]!.payload.forkee as { id: number }).id, 2);
  db.close();
});

test("commit comments: created, then edited", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [COMMENTS]: [{ id: 5, body: "hi", updated_at: "t1" }] });
  const state = emitFor(db, repo);
  await commitComment.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });

  gh.respond(COMMENTS, [{ id: 5, body: "hi there", updated_at: "t2" }]);
  await commitComment.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["created", "edited"],
  );
  db.close();
});
