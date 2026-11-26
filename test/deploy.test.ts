import assert from "node:assert/strict";
import { test } from "vitest";
import { deployKey } from "../src/adapters/deploy-key.ts";
import { deployment } from "../src/adapters/deployment.ts";
import { deploymentStatus } from "../src/adapters/deployment-status.ts";
import { repositoryRuleset } from "../src/adapters/repository-ruleset.ts";
import { StateStore } from "../src/db.ts";
import { emitFor, FakeGitHub } from "./helpers.ts";

const repo = "acme/app";
const DEPLOYMENTS_30 = "/repos/acme/app/deployments?per_page=30";
const DEPLOYMENTS_10 = "/repos/acme/app/deployments?per_page=10";
const STATUSES = "/repos/acme/app/deployments/1/statuses?per_page=20";
const KEYS = "/repos/acme/app/keys?per_page=100";
const RULESETS = "/repos/acme/app/rulesets?per_page=100";

function dep(overrides: Record<string, unknown> = {}) {
  return { id: 1, created_at: "t1", environment: "prod", ...overrides };
}

test("deployment: each new deployment emits created", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [DEPLOYMENTS_30]: [dep()] });
  const state = emitFor(db, repo);
  await deployment.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });

  assert.equal(state.deliveries.length, 1);
  assert.equal(state.deliveries[0]!.action, "created");
  assert.equal((state.deliveries[0]!.payload.deployment as { id: number }).id, 1);
  db.close();
});

test("deployment_status: statuses of recent deployments emit created", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({
    [DEPLOYMENTS_10]: [dep()],
    [STATUSES]: [{ id: 10, state: "success", created_at: "t1" }],
  });
  const state = emitFor(db, repo);
  await deploymentStatus.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });

  assert.equal(state.deliveries.length, 1);
  assert.equal((state.deliveries[0]!.payload.deployment_status as { id: number }).id, 10);
  db.close();
});

test("deploy keys: created, then deleted once", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({
    [KEYS]: [{ id: 3, title: "ci", key: "ssh-rsa AAAA", read_only: true }],
  });
  const state = emitFor(db, repo);

  await deployKey.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });
  gh.respond(KEYS, []);
  await deployKey.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });
  await deployKey.poll({ repo, refs: [], db, durations: db.durations, gh, emit: state.emit });

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["created", "deleted"],
  );
  db.close();
});

test("rulesets: created, edited, then deleted", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({
    [RULESETS]: [{ id: 5, name: "main", target: "branch", enforcement: "active" }],
  });
  const state = emitFor(db, repo);

  await repositoryRuleset.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });
  gh.respond(RULESETS, [{ id: 5, name: "main", target: "branch", enforcement: "disabled" }]);
  await repositoryRuleset.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });
  gh.respond(RULESETS, []);
  await repositoryRuleset.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["created", "edited", "deleted"],
  );
  db.close();
});
