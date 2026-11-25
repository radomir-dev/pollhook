import assert from "node:assert/strict";
import test from "node:test";
import { repositoryAdvisory } from "../src/adapters/repository-advisory.ts";
import { securityAndAnalysis } from "../src/adapters/security-and-analysis.ts";
import { vulnerabilityAlert } from "../src/adapters/vulnerability-alert.ts";
import { StateStore } from "../src/db.ts";
import { emitFor, FakeGitHub } from "./helpers.ts";

const repo = "acme/app";
const ADVISORIES = "/repos/acme/app/security-advisories?per_page=100";
const REPO = "/repos/acme/app";
const VULNERABILITY = "/repos/acme/app/vulnerability-alerts";

function advisory(overrides: Record<string, unknown> = {}) {
  return {
    ghsa_id: "GHSA-1",
    state: "published",
    updated_at: "t1",
    severity: "high",
    ...overrides,
  };
}

test("repository advisory: published, then closed", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [ADVISORIES]: [advisory()] });
  const state = emitFor(db, repo);

  await repositoryAdvisory.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });
  gh.respond(ADVISORIES, [advisory({ state: "closed", updated_at: "t2" })]);
  await repositoryAdvisory.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["published", "closed"],
  );
  db.close();
});

test("vulnerability alert: enable, then disable", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({}, { [VULNERABILITY]: false });
  const state = emitFor(db, repo);

  await vulnerabilityAlert.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });
  assert.equal(state.deliveries.length, 0, "first sight only records state");

  gh.probes[VULNERABILITY] = true;
  await vulnerabilityAlert.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });
  gh.probes[VULNERABILITY] = false;
  await vulnerabilityAlert.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["enable", "disable"],
  );
  db.close();
});

test("security and analysis: change carries from and to", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [REPO]: { id: 1, security_and_analysis: {} } });
  const state = emitFor(db, repo);

  await securityAndAnalysis.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });
  assert.equal(state.deliveries.length, 0);

  gh.respond(REPO, {
    id: 1,
    security_and_analysis: { advanced_security: { status: "enabled" } },
  });
  await securityAndAnalysis.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });

  assert.equal(state.deliveries.length, 1);
  const changes = state.deliveries[0]!.payload.changes as {
    security_and_analysis: { from: unknown; to: unknown };
  };
  assert.deepEqual(changes.security_and_analysis.from, {});
  assert.deepEqual(changes.security_and_analysis.to, {
    advanced_security: { status: "enabled" },
  });
  db.close();
});
