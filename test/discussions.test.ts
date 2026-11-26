import assert from "node:assert/strict";
import { test } from "vitest";
import { discussion } from "../src/adapters/discussion.ts";
import { discussionComment } from "../src/adapters/discussion-comment.ts";
import { StateStore } from "../src/db.ts";
import type { Adapter } from "../src/types.ts";
import { emitFor, FakeGitHub } from "./helpers.ts";

const repo = "acme/app";
const LIST = "/repos/acme/app/discussions?sort=updated&direction=desc&per_page=100";
const commentsOf = (number: number) =>
  `/repos/acme/app/discussions/${number}/comments?per_page=100`;

function item(overrides: Record<string, unknown> = {}) {
  return {
    number: 1,
    title: "How do I start?",
    body: "question",
    state: "open",
    state_reason: null,
    locked: false,
    answer_chosen_at: null,
    category: { id: 10, name: "Q&A" },
    labels: [],
    comments: 0,
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-01T10:00:00Z",
    ...overrides,
  };
}

function harness(adapter: Adapter, responses: Record<string, unknown>) {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub(responses);
  const out = emitFor(db, repo);
  const poll = () =>
    adapter.poll({ repo, refs: [], db, durations: db.durations, gh, emit: out.emit });
  return { db, gh, poll, deliveries: out.deliveries };
}

test("a new discussion is created once, and comment activity alone emits nothing", async () => {
  const h = harness(discussion, { [LIST]: [item()] });
  await h.poll();
  await h.poll();
  assert.deepEqual(
    h.deliveries.map((d) => d.action),
    ["created"],
  );

  h.gh.respond(LIST, [item({ comments: 3, updated_at: "2026-11-02T10:00:00Z" })]);
  await h.poll();
  assert.equal(h.deliveries.length, 1);
  h.db.close();
});

test("state changes are told apart: closed, reopened, locked, answered", async () => {
  const h = harness(discussion, { [LIST]: [item()] });
  await h.poll();
  const steps: Array<[Record<string, unknown>, string]> = [
    [{ state: "closed", state_reason: "resolved" }, "closed"],
    [{ state: "open", state_reason: "reopened" }, "reopened"],
    [{ locked: true }, "locked"],
    [{ locked: false }, "unlocked"],
    [{ answer_chosen_at: "2026-11-03T10:00:00Z" }, "answered"],
    [{ answer_chosen_at: null }, "unanswered"],
  ];
  for (const [change, expected] of steps) {
    h.gh.respond(LIST, [item(change)]);
    await h.poll();
    assert.equal(h.deliveries.at(-1)!.action, expected);
  }
  h.db.close();
});

test("a category change carries the previous category the way GitHub does", async () => {
  const h = harness(discussion, { [LIST]: [item()] });
  await h.poll();
  h.gh.respond(LIST, [item({ category: { id: 11, name: "Ideas" } })]);
  await h.poll();

  const last = h.deliveries.at(-1)!;
  assert.equal(last.action, "category_changed");
  assert.deepEqual((last.payload.changes as any).category.from, { id: 10, name: "Q&A" });
  h.db.close();
});

test("an edited title and a new label are separate actions", async () => {
  const h = harness(discussion, { [LIST]: [item()] });
  await h.poll();
  h.gh.respond(LIST, [item({ title: "How do I start it?", labels: [{ name: "docs" }] })]);
  await h.poll();

  assert.deepEqual(
    h.deliveries.slice(1).map((d) => d.action),
    ["labeled", "edited"],
  );
  h.db.close();
});

test("the first round of discussion comments records a baseline and fetches nothing", async () => {
  const h = harness(discussionComment, { [LIST]: [item({ comments: 4 })] });

  await h.poll();

  assert.equal(h.deliveries.length, 0);
  h.db.close();
});

test("only comments newer than the baseline are created, and a known comment can be edited", async () => {
  const h = harness(discussionComment, {
    [LIST]: [item({ comments: 1, updated_at: "2026-11-01T11:00:00Z" })],
  });
  await h.poll();

  const old = {
    id: 100,
    body: "first",
    created_at: "2026-11-01T11:00:00Z",
    updated_at: "2026-11-01T11:00:00Z",
  };
  const fresh = {
    id: 101,
    body: "second",
    created_at: "2026-11-02T10:00:00Z",
    updated_at: "2026-11-02T10:00:00Z",
  };
  h.gh.respond(LIST, [item({ comments: 2, updated_at: "2026-11-02T10:00:00Z" })]);
  h.gh.respond(commentsOf(1), [old, fresh]);
  await h.poll();
  assert.deepEqual(
    h.deliveries.map((d) => [d.action, d.key]),
    [["created", "101"]],
  );

  const edited = { ...fresh, body: "second, fixed", updated_at: "2026-11-03T10:00:00Z" };
  h.gh.respond(LIST, [item({ comments: 2, updated_at: "2026-11-03T10:00:00Z" })]);
  h.gh.respond(commentsOf(1), [old, edited]);
  await h.poll();
  assert.deepEqual(h.deliveries.at(-1)!.action, "edited");
  assert.equal(h.deliveries.length, 2);
  h.db.close();
});

test("a discussion that appears after the baseline delivers all its comments", async () => {
  const h = harness(discussionComment, { [LIST]: [] });
  await h.poll();

  const comment = {
    id: 7,
    body: "welcome",
    created_at: "2026-11-05T10:00:00Z",
    updated_at: "2026-11-05T10:00:00Z",
  };
  h.gh.respond(LIST, [item({ number: 5, comments: 1, updated_at: "2026-11-05T10:00:00Z" })]);
  h.gh.respond(commentsOf(5), [comment]);
  await h.poll();

  assert.deepEqual(
    h.deliveries.map((d) => d.action),
    ["created"],
  );
  h.db.close();
});

test("no more than ten discussions are read per round, and the rest follow on the next", async () => {
  const quiet = Array.from({ length: 12 }, (_, index) => item({ number: index + 1 }));
  const h = harness(discussionComment, { [LIST]: quiet });
  await h.poll();

  const busy = quiet.map((entry) => ({
    ...entry,
    comments: 1,
    updated_at: "2026-11-06T10:00:00Z",
  }));
  h.gh.respond(LIST, busy);
  for (let number = 1; number <= 10; number += 1) {
    h.gh.respond(commentsOf(number), [
      {
        id: number,
        body: "hi",
        created_at: "2026-11-06T10:00:00Z",
        updated_at: "2026-11-06T10:00:00Z",
      },
    ]);
  }
  await h.poll();
  assert.equal(h.deliveries.length, 10);

  for (const number of [11, 12]) {
    h.gh.respond(commentsOf(number), [
      {
        id: number,
        body: "hi",
        created_at: "2026-11-06T10:00:00Z",
        updated_at: "2026-11-06T10:00:00Z",
      },
    ]);
  }
  await h.poll();
  assert.equal(h.deliveries.length, 12);
  h.db.close();
});
