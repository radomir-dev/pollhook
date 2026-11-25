import assert from "node:assert/strict";
import test from "node:test";
import { label } from "../src/adapters/label.ts";
import { milestone } from "../src/adapters/milestone.ts";
import { release } from "../src/adapters/release.ts";
import { StateStore } from "../src/db.ts";
import { emitFor, FakeGitHub } from "./helpers.ts";

const repo = "acme/app";
const RELEASES = "/repos/acme/app/releases?per_page=30";
const LABELS = "/repos/acme/app/labels?per_page=100";
const MILESTONES = "/repos/acme/app/milestones?state=all&per_page=100";

function rel(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    tag_name: "v1",
    name: "v1",
    body: "",
    draft: false,
    prerelease: false,
    published_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function lab(name: string, overrides: Record<string, unknown> = {}) {
  return { name, color: "ffffff", description: "", default: false, ...overrides };
}

function ms(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    title: "v1",
    description: "",
    state: "open",
    due_on: null,
    open_issues: 0,
    closed_issues: 0,
    ...overrides,
  };
}

test("release: published on first sight, then published again from draft", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [RELEASES]: [rel()] });
  const state = emitFor(db, repo);
  await release.poll({ repo, refs: [], db, gh, emit: state.emit });
  assert.equal(state.deliveries.at(-1)!.action, "published");

  gh.respond(RELEASES, [rel({ id: 2, draft: true, published_at: null })]);
  await release.poll({ repo, refs: [], db, gh, emit: state.emit });
  assert.equal(state.deliveries.at(-1)!.action, "created");

  gh.respond(RELEASES, [rel({ id: 2, draft: false })]);
  await release.poll({ repo, refs: [], db, gh, emit: state.emit });
  assert.equal(state.deliveries.at(-1)!.action, "published");
  db.close();
});

test("label: created, edited, then deleted once", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [LABELS]: [lab("bug")] });
  const state = emitFor(db, repo);

  await label.poll({ repo, refs: [], db, gh, emit: state.emit });
  gh.respond(LABELS, [lab("bug", { color: "000000" })]);
  await label.poll({ repo, refs: [], db, gh, emit: state.emit });
  gh.respond(LABELS, []);
  await label.poll({ repo, refs: [], db, gh, emit: state.emit });
  await label.poll({ repo, refs: [], db, gh, emit: state.emit });

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["created", "edited", "deleted"],
  );
  db.close();
});

test("milestone: created, closed, then deleted", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [MILESTONES]: [ms()] });
  const state = emitFor(db, repo);

  await milestone.poll({ repo, refs: [], db, gh, emit: state.emit });
  gh.respond(MILESTONES, [ms({ state: "closed" })]);
  await milestone.poll({ repo, refs: [], db, gh, emit: state.emit });
  gh.respond(MILESTONES, []);
  await milestone.poll({ repo, refs: [], db, gh, emit: state.emit });

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["created", "closed", "deleted"],
  );
  db.close();
});
