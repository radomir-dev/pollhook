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
  orgs: [],
};

test("a permanent failure is degraded even when another adapter swallows its own 404", async () => {
  const db = new StateStore(":memory:");
  const poller = new Poller(config, db, new FakeGitHub({}), () => {});
  await poller.pollOnce();
  const status = poller.listStatuses()[0]!;
  assert.equal(status.lastError, null);
  assert.equal(status.degraded.length, 1);
  assert.equal(status.degraded[0]!.event, "workflow_run");
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

const workflowConfig: Config = {
  repos: [{ repo: "acme/app", events: ["workflow_run"], intervalMs: 1, checkRefLimit: 5 }],
  stateDir: "/tmp",
  orgs: [],
};

function runFixture(id: number, status: string, conclusion: string | null) {
  return {
    id,
    name: "CI",
    run_attempt: 1,
    status,
    conclusion,
    head_sha: "abc",
    html_url: "",
  };
}

test("the first poll of an event primes without delivering", async () => {
  const db = new StateStore(":memory:");
  const path = "/repos/acme/app/actions/runs?per_page=50";
  const gh = new FakeGitHub({ [path]: { workflow_runs: [runFixture(1, "in_progress", null)] } });

  let cold = 0;
  await new Poller(workflowConfig, db, gh, () => {
    cold += 1;
  }).pollOnce();
  assert.equal(cold, 0);
  assert.equal(db.listSnapshots("acme/app", "workflow_run").length, 1);

  let warm = 0;
  gh.respond(path, { workflow_runs: [runFixture(1, "completed", "success")] });
  await new Poller(workflowConfig, db, gh, () => {
    warm += 1;
  }).pollOnce();
  assert.equal(warm, 1);
  db.close();
});

test("priming is per event, not per object: a new object after a restart still delivers", async () => {
  const db = new StateStore(":memory:");
  const path = "/repos/acme/app/actions/runs?per_page=50";
  const gh = new FakeGitHub({ [path]: { workflow_runs: [runFixture(1, "in_progress", null)] } });
  await new Poller(workflowConfig, db, gh, () => {}).pollOnce();

  let emitted = 0;
  gh.respond(path, {
    workflow_runs: [runFixture(1, "in_progress", null), runFixture(9, "completed", "success")],
  });
  await new Poller(workflowConfig, db, gh, () => {
    emitted += 1;
  }).pollOnce();
  assert.equal(emitted, 1);
  db.close();
});

test("status reports the next poll time after a round", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({
    "/repos/acme/app/actions/runs?per_page=50": { workflow_runs: [] },
  });
  const poller = new Poller(workflowConfig, db, gh, () => {});
  await poller.pollOnce();

  const status = poller.listStatuses()[0]!;
  assert.ok(status.nextPollAt);
  assert.ok(Date.parse(status.nextPollAt) > Date.now());
  db.close();
});

test("a permanent error is reported as degraded, not as a round error", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({});
  const poller = new Poller(workflowConfig, db, gh, () => {});
  await poller.pollOnce();

  const status = poller.listStatuses()[0]!;
  assert.equal(status.lastError, null);
  assert.equal(status.degraded.length, 1);
  assert.equal(status.degraded[0]!.event, "workflow_run");
  assert.match(status.degraded[0]!.reason, /^404 /);
  assert.ok(
    Date.parse(status.nextPollAt!) > Date.now() + 50 * 60_000,
    "a degraded adapter backs off for an hour",
  );

  await poller.pollOnce();
  assert.equal(poller.listStatuses()[0]!.degraded.length, 1);
  db.close();
});

test("a transient error stays in lastError", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({}, {}, { "/repos/acme/app/actions/runs?per_page=50": "500 boom" });
  const poller = new Poller(workflowConfig, db, gh, () => {});
  await poller.pollOnce();

  const status = poller.listStatuses()[0]!;
  assert.equal(status.degraded.length, 0);
  assert.equal(status.lastError, "500 boom");
  assert.ok(
    Date.parse(status.nextPollAt!) < Date.now() + 5 * 60_000,
    "a transient error keeps the normal cadence",
  );
  db.close();
});
