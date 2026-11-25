import assert from "node:assert/strict";
import test from "node:test";
import type { Config } from "../src/config.ts";
import { StateStore } from "../src/db.ts";
import { Poller } from "../src/poller.ts";
import { FakeGitHub } from "./helpers.ts";

const config: Config = {
  repos: [
    {
      repo: "acme/app",
      events: ["workflow_run", "page_build"],
      intervalMs: 1,
      checkRefLimit: 5,
    },
  ],
  stateDir: "/tmp",
};

test("a failing adapter keeps the round error even when another adapter swallows its own", async () => {
  const db = new StateStore(":memory:");
  const poller = new Poller(config, db, new FakeGitHub({}), () => {});
  await poller.pollOnce();
  const status = poller.listStatuses()[0]!;
  assert.match(status.lastError ?? "", /^404 /);
  assert.equal(status.lastPollAt, null);
  db.close();
});

test("a clean round clears the error", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({
    "/repos/acme/app/actions/runs?per_page=50": {
      workflow_runs: [
        {
          id: 1,
          name: "CI",
          run_attempt: 1,
          status: "in_progress",
          conclusion: null,
          head_sha: "abc",
          html_url: "",
        },
      ],
    },
  });
  const poller = new Poller(config, db, gh, () => {});
  await poller.pollOnce();
  const status = poller.listStatuses()[0]!;
  assert.equal(status.lastError, null);
  assert.ok(status.lastPollAt);
  assert.equal(db.listSnapshots("acme/app", "workflow_run").length, 1);
  db.close();
});
