import assert from "node:assert/strict";
import test from "node:test";
import { brief } from "../src/cli/format.ts";
import type { Delivery } from "../src/types.ts";

function delivery(overrides: Partial<Delivery>): Delivery {
  return {
    id: "d1",
    repo: "acme/app",
    event: "workflow_run",
    action: "completed",
    key: "42",
    payload: {},
    createdAt: "2026-11-25T20:02:00.000Z",
    deliveredAt: null,
    ...overrides,
  };
}

test("brief prints the local time, repo, event, action and key on one line", () => {
  const line = brief(delivery({}));

  assert.match(line, /^\d{2}:\d{2}:\d{2} acme\/app workflow_run completed 42$/);
});

test("brief skips an empty action instead of leaving a gap", () => {
  const line = brief(delivery({ event: "push", action: null, key: "refs/heads/main" }));

  assert.match(line, /acme\/app push refs\/heads\/main$/);
  assert.doesNotMatch(line, / {2}/);
});
