import assert from "node:assert/strict";
import test from "node:test";
import { codeScanningAlert } from "../src/adapters/code-scanning-alert.ts";
import { dependabotAlert } from "../src/adapters/dependabot-alert.ts";
import { secretScanningAlert } from "../src/adapters/secret-scanning-alert.ts";
import { StateStore } from "../src/db.ts";
import { emitFor, FakeGitHub } from "./helpers.ts";

const repo = "acme/app";
const DEPENDABOT =
  "/repos/acme/app/dependabot/alerts?state=open,dismissed,fixed,auto_dismissed&per_page=100";
const codePath = (state: string) => `/repos/acme/app/code-scanning/alerts?state=${state}&per_page=100`;
const secretPath = (state: string) => `/repos/acme/app/secret-scanning/alerts?state=${state}&per_page=100`;

function dependencyAlert(overrides: Record<string, unknown> = {}) {
  return { number: 1, state: "open", updated_at: "t1", ...overrides };
}

function scanningAlert(overrides: Record<string, unknown> = {}) {
  return { number: 1, state: "open", updated_at: "t1", ...overrides };
}

function secretAlert(overrides: Record<string, unknown> = {}) {
  return { number: 1, state: "open", validation_status: "unknown", updated_at: "t1", ...overrides };
}

test("dependabot: created, dismissed, fixed", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [DEPENDABOT]: [dependencyAlert()] });
  const state = emitFor(db, repo);

  await dependabotAlert.poll({ repo, refs: [], db, gh, emit: state.emit });
  gh.respond(DEPENDABOT, [dependencyAlert({ state: "dismissed", updated_at: "t2" })]);
  await dependabotAlert.poll({ repo, refs: [], db, gh, emit: state.emit });
  gh.respond(DEPENDABOT, [dependencyAlert({ state: "fixed", updated_at: "t3" })]);
  await dependabotAlert.poll({ repo, refs: [], db, gh, emit: state.emit });

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["created", "dismissed", "fixed"],
  );
  db.close();
});

test("code scanning: created, fixed, reopened", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({
    [codePath("open")]: [scanningAlert()],
    [codePath("dismissed")]: [],
    [codePath("fixed")]: [],
  });
  const state = emitFor(db, repo);
  await codeScanningAlert.poll({ repo, refs: [], db, gh, emit: state.emit });

  gh.respond(codePath("open"), []);
  gh.respond(codePath("fixed"), [scanningAlert({ state: "fixed", updated_at: "t2" })]);
  await codeScanningAlert.poll({ repo, refs: [], db, gh, emit: state.emit });

  gh.respond(codePath("fixed"), []);
  gh.respond(codePath("open"), [scanningAlert({ state: "open", updated_at: "t3" })]);
  await codeScanningAlert.poll({ repo, refs: [], db, gh, emit: state.emit });

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["created", "fixed", "reopened"],
  );
  db.close();
});

test("secret scanning: created, resolved, validated", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({
    [secretPath("open")]: [secretAlert()],
    [secretPath("resolved")]: [],
  });
  const state = emitFor(db, repo);
  await secretScanningAlert.poll({ repo, refs: [], db, gh, emit: state.emit });

  gh.respond(secretPath("open"), []);
  gh.respond(secretPath("resolved"), [secretAlert({ state: "resolved", updated_at: "t2" })]);
  await secretScanningAlert.poll({ repo, refs: [], db, gh, emit: state.emit });

  gh.respond(secretPath("resolved"), []);
  gh.respond(secretPath("open"), [
    secretAlert({ state: "open", validation_status: "active", updated_at: "t3" }),
  ]);
  await secretScanningAlert.poll({ repo, refs: [], db, gh, emit: state.emit });

  gh.respond(secretPath("open"), [
    secretAlert({ state: "open", validation_status: "inactive", updated_at: "t4" }),
  ]);
  await secretScanningAlert.poll({ repo, refs: [], db, gh, emit: state.emit });

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["created", "resolved", "reopened", "validated"],
  );
  db.close();
});
