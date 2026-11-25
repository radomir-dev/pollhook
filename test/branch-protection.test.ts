import assert from "node:assert/strict";
import test from "node:test";
import { branchProtection } from "../src/adapters/branch-protection.ts";
import { StateStore } from "../src/db.ts";
import { emitFor, FakeGitHub } from "./helpers.ts";

const repo = "acme/app";
const BRANCHES = "/repos/acme/app/branches?per_page=100";
const PROTECTION = "/repos/acme/app/branches/main/protection";

function protection(overrides: Record<string, unknown> = {}) {
  return {
    required_status_checks: { strict: true, contexts: ["ci"] },
    enforce_admins: { enabled: true },
    ...overrides,
  };
}

test("branch protection: first sight primes, then a change carries from and to", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({
    [BRANCHES]: [{ name: "main" }],
    [PROTECTION]: protection(),
  });
  const state = emitFor(db, repo);

  await branchProtection.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });
  assert.equal(state.deliveries.length, 0, "priming records without delivering");

  gh.respond(PROTECTION, protection({ enforce_admins: { enabled: false } }));
  await branchProtection.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });

  assert.equal(state.deliveries.length, 1);
  assert.equal(state.deliveries[0]!.action, "edited");
  const changes = state.deliveries[0]!.payload.changes as {
    branch_protection: { from: any; to: any };
  };
  assert.equal(changes.branch_protection.from.enforce_admins.enabled, true);
  assert.equal(changes.branch_protection.to.enforce_admins.enabled, false);
  db.close();
});

test("branch protection: an unprotected branch is skipped", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [BRANCHES]: [{ name: "feature" }] });
  const state = emitFor(db, repo);
  await branchProtection.poll({
    repo,
    refs: [],
    db,
    durations: db.durations,
    gh,
    emit: state.emit,
  });
  assert.equal(state.deliveries.length, 0);
  db.close();
});
