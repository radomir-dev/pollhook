import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { team } from "../src/adapters/team.ts";
import { loadConfig, type Config } from "../src/config.ts";
import { StateStore } from "../src/db.ts";
import { Poller } from "../src/poller.ts";
import { emitFor, FakeGitHub, tempStateDir } from "./helpers.ts";

const TEAMS = "/orgs/acme/teams?per_page=100";

function configFile(raw: unknown): string {
  const path = join(tempStateDir(), "config.json");
  writeFileSync(path, JSON.stringify(raw));
  return path;
}

test("config accepts orgs without repos and defaults to org events", () => {
  const config = loadConfig(configFile({ orgs: [{ org: "acme" }] }));
  assert.equal(config.repos.length, 0);
  assert.equal(config.orgs[0]!.org, "acme");
  assert.deepEqual(config.orgs[0]!.events, ["team", "membership"]);
  assert.equal(config.orgs[0]!.intervalMs, 300_000);
});

test("config rejects a repo event on an org target", () => {
  assert.throws(
    () => loadConfig(configFile({ orgs: [{ org: "acme", events: ["push"] }] })),
    /not available for org/,
  );
});

test("config rejects an empty config", () => {
  assert.throws(() => loadConfig(configFile({})), /at least one of repos or orgs/);
});

test("team: created, edited, deleted", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [TEAMS]: [{ id: 1, name: "core", slug: "core" }] });
  const state = emitFor(db, "acme");
  const ctx = { repo: "acme", org: "acme", refs: [], db, durations: db.durations, gh, emit: state.emit };

  await team.poll(ctx);
  gh.respond(TEAMS, [{ id: 1, name: "core", slug: "core", description: "x" }]);
  await team.poll(ctx);
  gh.respond(TEAMS, []);
  await team.poll(ctx);

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["created", "edited", "deleted"],
  );
  assert.equal((state.deliveries[0]!.payload.organization as { login: string }).login, "acme");
  db.close();
});

test("poller routes org events to the org target", async () => {
  const db = new StateStore(":memory:");
  const config: Config = {
    repos: [],
    orgs: [{ org: "acme", events: ["team"], intervalMs: 1 }],
    stateDir: "/tmp",
  };
  const gh = new FakeGitHub({ [TEAMS]: [{ id: 1, name: "core" }] });
  let emits = 0;

  await new Poller(config, db, gh, () => {
    emits += 1;
  }).pollOnce();
  assert.equal(emits, 0, "first poll primes the org adapter");

  gh.respond(TEAMS, [
    { id: 1, name: "core" },
    { id: 2, name: "infra" },
  ]);
  const poller = new Poller(config, db, gh, () => {
    emits += 1;
  });
  await poller.pollOnce();

  assert.equal(emits, 1);
  assert.equal(poller.listStatuses()[0]!.kind, "org");
  assert.equal(poller.listStatuses()[0]!.repo, "acme");
  db.close();
});
