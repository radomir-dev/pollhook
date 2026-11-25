import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import type { Config } from "../src/config.ts";
import { startDaemon } from "../src/daemon.ts";
import { FakeGitHub, rpcTo, tempStateDir } from "./helpers.ts";

const RUNS_PATH = "/repos/acme/app/actions/runs?per_page=50";

function configFor(stateDir: string): Config {
  return {
    repos: [{ repo: "acme/app", events: ["workflow_run"], intervalMs: 60_000, checkRefLimit: 5 }],
    stateDir,
  };
}

function run(status: string, conclusion: string | null) {
  return {
    id: 7,
    name: "CI",
    run_attempt: 1,
    status,
    conclusion,
    head_sha: "abc",
    html_url: "https://github.com/acme/app/actions/runs/7",
  };
}

test("daemon answers status and times out an unfinished wait", async () => {
  const stateDir = tempStateDir();
  const gh = new FakeGitHub({ [RUNS_PATH]: { workflow_runs: [run("in_progress", null)] } });
  const daemon = await startDaemon(configFor(stateDir), {
    gh,
    socketPath: join(stateDir, "test.sock"),
  });
  try {
    const status = await rpcTo(daemon.socketPath, { op: "status" });
    assert.equal(status.ok, true);
    assert.equal(status.body.repos[0].repo, "acme/app");

    const wait = await rpcTo(daemon.socketPath, {
      op: "wait",
      timeoutMs: 400,
      request: { kind: "run", repo: "acme/app", id: "7" },
    });
    assert.equal(wait.exitCode, 8);
    assert.equal(wait.body.reason, "timeout");

    const after = await rpcTo(daemon.socketPath, { op: "status" });
    assert.equal(after.body.waiters, 0);
  } finally {
    await daemon.close();
  }
});

test("daemon returns a run that already finished without waiting for an event", async () => {
  const stateDir = tempStateDir();
  const gh = new FakeGitHub({ [RUNS_PATH]: { workflow_runs: [run("completed", "success")] } });
  const daemon = await startDaemon(configFor(stateDir), {
    gh,
    socketPath: join(stateDir, "test.sock"),
  });
  try {
    const wait = await rpcTo(daemon.socketPath, {
      op: "wait",
      timeoutMs: 3000,
      request: { kind: "run", repo: "acme/app", id: "7" },
    });
    assert.equal(wait.exitCode, 0);
    assert.equal(wait.body.conclusion, "success");
  } finally {
    await daemon.close();
  }
});
