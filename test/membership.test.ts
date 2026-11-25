import assert from "node:assert/strict";
import test from "node:test";
import { membership } from "../src/adapters/membership.ts";
import { StateStore } from "../src/db.ts";
import { emitFor, FakeGitHub } from "./helpers.ts";

const TEAMS = "/orgs/acme/teams?per_page=100";
const MEMBERS = "/orgs/acme/teams/core/members?per_page=100";

function setup(members: Array<{ id: number; login: string }>) {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({
    [TEAMS]: [{ id: 1, slug: "core", name: "Core" }],
    [MEMBERS]: members,
  });
  const state = emitFor(db, "acme");
  const ctx = { repo: "acme", org: "acme", refs: [], db, durations: db.durations, gh, emit: state.emit };
  return { db, gh, state, ctx };
}

test("membership: added per team member, removed when the pair disappears", async () => {
  const { db, gh, state, ctx } = setup([{ id: 1, login: "ana" }]);

  await membership.poll(ctx);
  gh.respond(MEMBERS, [
    { id: 1, login: "ana" },
    { id: 2, login: "bo" },
  ]);
  await membership.poll(ctx);
  gh.respond(MEMBERS, [{ id: 2, login: "bo" }]);
  await membership.poll(ctx);
  await membership.poll(ctx);

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["added", "added", "removed"],
  );
  assert.equal(state.deliveries[0]!.payload.scope, "team");
  assert.equal((state.deliveries[0]!.payload.organization as { login: string }).login, "acme");
  db.close();
});

test("membership: a 304 on the member list does not look like a removal", async () => {
  const { db, gh, state, ctx } = setup([{ id: 1, login: "ana" }]);
  await membership.poll(ctx);

  gh.respond(MEMBERS, null);
  await membership.poll(ctx);

  assert.equal(state.deliveries.length, 1);
  db.close();
});

test("membership: teams outside the polled set keep their members", async () => {
  const db = new StateStore(":memory:");
  db.putSnapshot("acme", "membership", "other:ana", "1", {
    user: { login: "ana" },
    team: { slug: "other" },
  });
  const gh = new FakeGitHub({
    [TEAMS]: [{ id: 1, slug: "core", name: "Core" }],
    [MEMBERS]: [{ id: 1, login: "ana" }],
  });
  const state = emitFor(db, "acme");
  await membership.poll({ repo: "acme", org: "acme", refs: [], db, durations: db.durations, gh, emit: state.emit });

  assert.equal(state.deliveries.length, 1);
  assert.equal(state.deliveries[0]!.key, "core:ana");
  db.close();
});
