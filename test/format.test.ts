import assert from "node:assert/strict";
import { test } from "vitest";
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

function run(patch: Record<string, unknown>) {
  return {
    payload: {
      workflow_run: {
        name: "CI",
        status: "completed",
        conclusion: "success",
        run_started_at: new Date(Date.now() - 90_000).toISOString(),
        ...patch,
      },
    },
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

test("a completed run shows its name and conclusion", () => {
  const line = brief(delivery(run({})));

  assert.match(line, /42 CI success$/);
});

test("an in-progress run shows its name and how long it has been running", () => {
  const line = brief(delivery({ action: "in_progress", ...run({ status: "in_progress" }) }));

  assert.match(line, /42 CI 1m30s$/);
});

test("a long run name is truncated so the line stays short", () => {
  const line = brief(delivery(run({ name: "Build and publish every package to the registry" })));

  assert.match(line, /… success$/);
  assert.ok(line.length < 120);
});

test("events without a subject still print a plain line", () => {
  const line = brief(
    delivery({ event: "push", action: "created", key: "refs/heads/main", payload: {} }),
  );

  assert.match(line, /push created refs\/heads\/main$/);
});
