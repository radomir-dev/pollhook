import assert from "node:assert/strict";
import test from "node:test";
import { deploymentProtectionRule } from "../src/adapters/deployment-protection-rule.ts";
import { StateStore } from "../src/db.ts";
import type { AdapterEmit, Delivery } from "../src/types.ts";
import { FakeGitHub, emitFor } from "./helpers.ts";

const repo = "acme/app";
const ENVS = `/repos/${repo}/environments?per_page=100`;
const rules = (env: string) => `/repos/${repo}/environments/${env}/deployment_protection_rules`;

function rule(patch: Record<string, unknown> = {}) {
  return { id: 11, node_id: "R_1", enabled: true, app: { id: 5, slug: "ops-gate" }, ...patch };
}

function context(db: StateStore, gh: FakeGitHub, state: { deliveries: Delivery[]; emit: AdapterEmit }) {
  return { repo, refs: [], db, durations: db.durations, gh, emit: state.emit };
}

test("a new protection rule is created, a changed one is edited", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({
    [ENVS]: { environments: [{ name: "production" }] },
    [rules("production")]: { custom_deployment_protection_rules: [rule()] },
  });
  const state = emitFor(db, repo);
  const ctx = context(db, gh, state);

  await deploymentProtectionRule.poll(ctx);
  assert.equal(state.deliveries.length, 1);
  assert.equal(state.deliveries[0]!.action, "created");
  assert.equal(state.deliveries[0]!.key, "production:11");

  await deploymentProtectionRule.poll(ctx);
  assert.equal(state.deliveries.length, 1);

  gh.respond(rules("production"), { custom_deployment_protection_rules: [rule({ enabled: false })] });
  await deploymentProtectionRule.poll(ctx);

  assert.equal(state.deliveries.length, 2);
  assert.equal(state.deliveries[1]!.action, "edited");
  db.close();
});

test("a rule that disappears from an environment is deleted once", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({
    [ENVS]: { environments: [{ name: "production" }] },
    [rules("production")]: { custom_deployment_protection_rules: [rule()] },
  });
  const state = emitFor(db, repo);
  const ctx = context(db, gh, state);
  await deploymentProtectionRule.poll(ctx);

  gh.respond(rules("production"), { custom_deployment_protection_rules: [] });
  await deploymentProtectionRule.poll(ctx);
  await deploymentProtectionRule.poll(ctx);

  const actions = state.deliveries.map((delivery) => delivery.action);
  assert.deepEqual(actions, ["created", "deleted"]);
  db.close();
});

test("rules are tracked per environment", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({
    [ENVS]: { environments: [{ name: "production" }, { name: "staging" }] },
    [rules("production")]: { custom_deployment_protection_rules: [rule()] },
    [rules("staging")]: { custom_deployment_protection_rules: [rule()] },
  });
  const state = emitFor(db, repo);

  await deploymentProtectionRule.poll(context(db, gh, state));

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.key),
    ["production:11", "staging:11"],
  );
  db.close();
});
