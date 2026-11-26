import assert from "node:assert/strict";
import { test } from "vitest";
import { pullRequestReviewComment } from "../src/adapters/pull-request-review-comment.ts";
import { StateStore } from "../src/db.ts";
import { FakeGitHub, emitFor } from "./helpers.ts";

const repo = "acme/app";
const COMMENTS = `/repos/${repo}/pulls/comments?sort=updated&direction=desc&per_page=100`;

function comment(patch: Record<string, unknown> = {}) {
  return {
    id: 700,
    body: "nit: rename this",
    path: "src/app.ts",
    pull_request_url: `https://api.github.com/repos/${repo}/pulls/12`,
    updated_at: "2026-11-25T20:00:00Z",
    ...patch,
  };
}

test("a review comment is created once and edited when its body changes", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [COMMENTS]: [comment()] });
  const state = emitFor(db, repo);
  const ctx = { repo, refs: [], db, durations: db.durations, gh, emit: state.emit };

  await pullRequestReviewComment.poll(ctx);
  assert.equal(state.deliveries.length, 1);
  assert.equal(state.deliveries[0]!.action, "created");
  assert.equal(state.deliveries[0]!.key, "700");

  await pullRequestReviewComment.poll(ctx);
  assert.equal(state.deliveries.length, 1);

  gh.respond(COMMENTS, [
    comment({ body: "nit: rename this helper", updated_at: "2026-11-25T20:05:00Z" }),
  ]);
  await pullRequestReviewComment.poll(ctx);

  assert.equal(state.deliveries.length, 2);
  assert.equal(state.deliveries[1]!.action, "edited");
  db.close();
});

test("the comment carries the pull request it belongs to", async () => {
  const db = new StateStore(":memory:");
  db.putSnapshot(repo, "pull_request", "12", "open", { number: 12, title: "Tidy the adapter" });
  const gh = new FakeGitHub({ [COMMENTS]: [comment()] });
  const state = emitFor(db, repo);

  await pullRequestReviewComment.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });

  const pullRequest = state.deliveries[0]!.payload.pull_request as any;
  assert.equal(pullRequest.title, "Tidy the adapter");
  db.close();
});
