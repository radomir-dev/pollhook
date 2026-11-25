import assert from "node:assert/strict";
import test from "node:test";
import type { Config } from "../src/config.ts";
import { StateStore } from "../src/db.ts";
import { Poller } from "../src/poller.ts";
import { FakeGitHub } from "./helpers.ts";

const RUNS = "/repos/acme/app/actions/runs?per_page=50";
const config: Config = {
  repos: [{ repo: "acme/app", events: ["workflow_run"], intervalMs: 600_000, checkRefLimit: 5 }],
  orgs: [],
  stateDir: "/tmp",
};

function run(status: string) {
  return { id: 1, name: "CI", run_attempt: 1, status, conclusion: null, head_sha: "a", html_url: "" };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("poke polls now instead of waiting out a long interval", async () => {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub({ [RUNS]: { workflow_runs: [] } });
  const seen: string[] = [];
  const poller = new Poller(config, db, gh, (_repo, _event, action) => seen.push(String(action)));
  poller.start();
  await pause(100);

  gh.respond(RUNS, { workflow_runs: [run("in_progress")] });
  assert.equal(poller.poke("acme/app"), true);
  await pause(300);
  poller.stop();

  assert.deepEqual(seen, ["in_progress"]);
  db.close();
});

test("poke rejects a repository that is not configured", () => {
  const db = new StateStore(":memory:");
  const poller = new Poller(config, db, new FakeGitHub({}), () => {});

  assert.equal(poller.poke("other/repo"), false);
  db.close();
});
