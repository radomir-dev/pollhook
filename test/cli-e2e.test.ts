import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { Config } from "../src/config.ts";
import { startDaemon } from "../src/daemon.ts";
import { FakeGitHub, tempStateDir } from "./helpers.ts";

const RUNS = "/repos/acme/app/actions/runs?per_page=50";

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(status: string, conclusion: string | null, id: number) {
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

function cli(args: string[], configPath: string, stateDir: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["src/cli.ts", ...args], {
      cwd: join(import.meta.dirname, ".."),
      env: { ...process.env, POLLHOOK_CONFIG: configPath, XDG_RUNTIME_DIR: stateDir },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), 8000);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

function writeConfig(stateDir: string): string {
  const path = join(stateDir, "config.json");
  const config = {
    repos: [{ repo: "acme/app", events: ["workflow_run"], intervalSeconds: 60 }],
    orgs: [],
    stateDir,
  };
  writeFileSync(path, JSON.stringify(config));
  return path;
}

test("the CLI talks to a running daemon and returns the wait exit codes", async () => {
  const stateDir = tempStateDir();
  const configPath = writeConfig(stateDir);
  const config: Config = {
    repos: [{ repo: "acme/app", events: ["workflow_run"], intervalMs: 60_000, checkRefLimit: 5 }],
    orgs: [],
    stateDir,
  };
  const previous = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = stateDir;
  const gh = new FakeGitHub({
    [RUNS]: { workflow_runs: [run("completed", "success", 7), run("in_progress", null, 8)] },
  });
  const daemon = await startDaemon(config, { gh });

  try {
    const status = await cli(["status", "--json"], configPath, stateDir);
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).repos[0].repo, "acme/app");

    const finished = await cli(["run", "7"], configPath, stateDir);
    assert.equal(finished.status, 0, finished.stderr);
    assert.equal(JSON.parse(finished.stdout).conclusion, "success");

    const timedOut = await cli(["run", "8", "--timeout", "1s"], configPath, stateDir);
    assert.equal(timedOut.status, 8);
    assert.equal(JSON.parse(timedOut.stdout).reason, "timeout");
  } finally {
    await daemon.close();
    if (previous === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = previous;
  }
});

test("status exits 2 when no daemon is listening", async () => {
  const stateDir = tempStateDir();
  const configPath = writeConfig(stateDir);
  const result = await cli(["status"], configPath, stateDir);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /cannot reach pollhook/);
});
