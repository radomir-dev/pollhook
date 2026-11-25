import assert from "node:assert/strict";
import test from "node:test";
import { member } from "../src/adapters/member.ts";
import { StateStore } from "../src/db.ts";
import { emitFor, FakeGitHub } from "./helpers.ts";

const repo = "acme/app";
const COLLABORATORS = "/repos/acme/app/collaborators?per_page=100";

function user(login: string, push: boolean) {
  return { login, permissions: { pull: true, push } };
}

test("member: added, edited, then removed once", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [COLLABORATORS]: [user("ana", true)] });
  const state = emitFor(db, repo);

  await member.poll({ repo, refs: [], db, gh, emit: state.emit });
  gh.respond(COLLABORATORS, [user("ana", false)]);
  await member.poll({ repo, refs: [], db, gh, emit: state.emit });
  gh.respond(COLLABORATORS, []);
  await member.poll({ repo, refs: [], db, gh, emit: state.emit });
  await member.poll({ repo, refs: [], db, gh, emit: state.emit });

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["added", "edited", "removed"],
  );
  assert.equal((state.deliveries[0]!.payload.member as { login: string }).login, "ana");
  db.close();
});

test("member: a new collaborator after the list is seeded emits added", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [COLLABORATORS]: [user("ana", true)] });
  const state = emitFor(db, repo);

  await member.poll({ repo, refs: [], db, gh, emit: state.emit });
  gh.respond(COLLABORATORS, [user("ana", true), user("bo", true)]);
  await member.poll({ repo, refs: [], db, gh, emit: state.emit });

  assert.equal(state.deliveries.length, 2);
  assert.equal((state.deliveries[1]!.payload.member as { login: string }).login, "bo");
  db.close();
});
