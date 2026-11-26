import assert from "node:assert/strict";
import { test } from "vitest";
import { customProperty } from "../src/adapters/custom-property.ts";
import { customPropertyValues } from "../src/adapters/custom-property-values.ts";
import { orgBlock } from "../src/adapters/org-block.ts";
import { organization } from "../src/adapters/organization.ts";
import { StateStore } from "../src/db.ts";
import type { Adapter } from "../src/types.ts";
import { emitFor, FakeGitHub } from "./helpers.ts";

const BLOCKS = "/orgs/acme/blocks?per_page=100";
const SCHEMA = "/orgs/acme/properties/schema";
const VALUES = "/orgs/acme/properties/values?per_page=100";
const PROFILE = "/orgs/acme";
const MEMBERS = "/orgs/acme/members?per_page=100";
const INVITATIONS = "/orgs/acme/invitations?per_page=100";

function setup(adapter: Adapter, responses: Record<string, unknown>) {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub(responses);
  const state = emitFor(db, "acme");
  const poll = () =>
    adapter.poll({
      repo: "acme",
      org: "acme",
      refs: [],
      db,
      durations: db.durations,
      gh,
      emit: state.emit,
    });
  const actions = () => state.deliveries.map((delivery) => delivery.action);
  return { db, gh, poll, actions, state };
}

const user = (login: string) => ({ login, id: login.length });

test("org_block: blocked, unblocked, and blocked again is delivered again", async () => {
  const { db, gh, poll, actions } = setup(orgBlock, { [BLOCKS]: [] });
  await poll();
  gh.respond(BLOCKS, [user("mallory")]);
  await poll();
  gh.respond(BLOCKS, []);
  await poll();
  gh.respond(BLOCKS, [user("mallory")]);
  await poll();

  assert.deepEqual(actions(), ["blocked", "unblocked", "blocked"]);
  db.close();
});

test("custom_property: created, updated, deleted", async () => {
  const definition = (extra = {}) => ({ property_name: "team", value_type: "string", ...extra });
  const { db, gh, poll, actions, state } = setup(customProperty, { [SCHEMA]: [] });
  await poll();
  gh.respond(SCHEMA, [definition()]);
  await poll();
  gh.respond(SCHEMA, [definition({ required: true })]);
  await poll();
  gh.respond(SCHEMA, []);
  await poll();

  assert.deepEqual(actions(), ["created", "updated", "deleted"]);
  assert.equal((state.deliveries[1]!.payload.definition as { required: boolean }).required, true);
  db.close();
});

test("custom_property_values: a repository's values changing carries old and new", async () => {
  const entry = (value: string) => ({
    repository_id: 7,
    repository_name: "app",
    repository_full_name: "acme/app",
    properties: [{ property_name: "team", value }],
  });
  const { db, gh, poll, state } = setup(customPropertyValues, { [VALUES]: [entry("a")] });
  await poll();
  gh.respond(VALUES, [entry("b")]);
  await poll();

  assert.equal(state.deliveries.length, 2);
  const payload = state.deliveries[1]!.payload as any;
  assert.equal(payload.old_property_values[0].value, "a");
  assert.equal(payload.new_property_values[0].value, "b");
  assert.equal(payload.repository.full_name, "acme/app");
  db.close();
});

test("custom_property_values: a repository that appears with no values is ignored", async () => {
  const { db, gh, poll, actions } = setup(customPropertyValues, { [VALUES]: [] });
  await poll();
  gh.respond(VALUES, [{ repository_id: 7, repository_name: "app", properties: [] }]);
  await poll();

  assert.deepEqual(actions(), []);
  db.close();
});

test("organization: member added and removed, invitation, and rename", async () => {
  const { db, gh, poll, actions, state } = setup(organization, {
    [PROFILE]: { id: 1, login: "acme" },
    [MEMBERS]: [user("ann")],
    [INVITATIONS]: [],
  });
  await poll();
  gh.respond(MEMBERS, [user("ann"), user("bob")]);
  await poll();
  gh.respond(MEMBERS, [user("bob")]);
  gh.respond(INVITATIONS, [{ id: 9, login: "carol" }]);
  await poll();
  gh.respond(PROFILE, { id: 1, login: "acme-inc" });
  await poll();

  assert.deepEqual(actions(), [
    "member_added",
    "member_added",
    "member_removed",
    "member_invited",
    "renamed",
  ]);
  const renamed = state.deliveries[4]!.payload as any;
  assert.equal(renamed.changes.login.from, "acme");
  assert.equal(renamed.organization.login, "acme-inc");
  db.close();
});
