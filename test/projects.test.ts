import assert from "node:assert/strict";
import { test } from "vitest";
import { projectsV2 } from "../src/adapters/projects-v2.ts";
import { projectsV2Item } from "../src/adapters/projects-v2-item.ts";
import { StateStore } from "../src/db.ts";
import type { Adapter } from "../src/types.ts";
import { emitFor, FakeGitHub } from "./helpers.ts";

const PROJECTS = "/orgs/acme/projectsV2?per_page=100";
const FIELDS = "/orgs/acme/projectsV2/1/fields";
const ITEMS = "/orgs/acme/projectsV2/1/items?per_page=100&fields=10,11";

const project = (overrides: Record<string, unknown> = {}) => ({
  number: 1,
  node_id: "PVT_1",
  title: "Roadmap",
  public: false,
  closed_at: null,
  updated_at: "t1",
  ...overrides,
});
const item = (id: number, status: string, updatedAt = "t1") => ({
  id,
  updated_at: updatedAt,
  archived_at: null,
  fields: [{ id: 11, name: "Status", value: status }],
});

function setup(adapter: Adapter, responses: Record<string, unknown>) {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [FIELDS]: [{ id: 10 }, { id: 11 }], ...responses });
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

test("projects_v2: created, edited, closed, reopened, deleted", async () => {
  const { db, gh, poll, actions } = setup(projectsV2, { [PROJECTS]: [project()] });
  await poll();
  gh.respond(PROJECTS, [project({ title: "Plan" })]);
  await poll();
  gh.respond(PROJECTS, [project({ title: "Plan", closed_at: "t2" })]);
  await poll();
  gh.respond(PROJECTS, [project({ title: "Plan" })]);
  await poll();
  gh.respond(PROJECTS, []);
  await poll();

  assert.deepEqual(actions(), ["created", "edited", "closed", "reopened", "deleted"]);
  db.close();
});

test("projects_v2: a moved updated_at alone is not an edit", async () => {
  const { db, gh, poll, actions } = setup(projectsV2, { [PROJECTS]: [project()] });
  await poll();
  gh.respond(PROJECTS, [project({ updated_at: "t2" })]);
  await poll();

  assert.deepEqual(actions(), ["created"]);
  db.close();
});

test("projects_v2: a full page is truncated, so absence is not a deletion", async () => {
  const full = Array.from({ length: 100 }, (_, index) => project({ number: index + 1 }));
  const { db, gh, poll, actions } = setup(projectsV2, { [PROJECTS]: full });
  await poll();
  gh.respond(PROJECTS, [...full.slice(1), project({ number: 101 })]);
  await poll();

  assert.equal(actions().includes("deleted"), false);
  db.close();
});

test("projects_v2_item: created, edited by a field change, deleted", async () => {
  const { db, gh, poll, state } = setup(projectsV2Item, {
    [PROJECTS]: [project()],
    [ITEMS]: [item(5, "Todo")],
  });
  await poll();
  gh.respond(PROJECTS, [project({ updated_at: "t2" })]);
  gh.respond(ITEMS, [item(5, "Done", "t2")]);
  await poll();
  gh.respond(PROJECTS, [project({ updated_at: "t3" })]);
  gh.respond(ITEMS, []);
  await poll();

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["created", "edited", "deleted"],
  );
  const payload = state.deliveries[1]!.payload.projects_v2_item as { project_node_id: string };
  assert.equal(payload.project_node_id, "PVT_1");
  db.close();
});

test("projects_v2_item: items are read only for projects whose updated_at moved", async () => {
  const { db, gh, poll, actions } = setup(projectsV2Item, {
    [PROJECTS]: [project()],
    [ITEMS]: [item(5, "Todo")],
  });
  await poll();
  gh.respond(ITEMS, [item(5, "Done", "t2")]);
  await poll();

  assert.deepEqual(actions(), ["created"]);
  db.close();
});

test("projects_v2_item: a restored item is delivered as created again", async () => {
  const { db, gh, poll, actions } = setup(projectsV2Item, {
    [PROJECTS]: [project()],
    [ITEMS]: [item(5, "Todo")],
  });
  await poll();
  gh.respond(PROJECTS, [project({ updated_at: "t2" })]);
  gh.respond(ITEMS, []);
  await poll();
  gh.respond(PROJECTS, [project({ updated_at: "t3" })]);
  gh.respond(ITEMS, [item(5, "Todo", "t3")]);
  await poll();

  assert.deepEqual(actions(), ["created", "deleted", "created"]);
  db.close();
});
