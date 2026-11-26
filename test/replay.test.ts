import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, type Socket } from "node:net";
import { test } from "vitest";
import type { Config } from "../src/config.ts";
import { startDaemon } from "../src/daemon.ts";
import { FakeGitHub, rpcTo, tempStateDir } from "./helpers.ts";

const RUNS = "/repos/acme/app/actions/runs?per_page=50";
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const run = (id: number, status: string, conclusion: string | null) => ({
  id,
  name: "CI",
  run_attempt: 1,
  status,
  conclusion,
  head_sha: "abc",
  html_url: "",
  workflow_id: 1,
});

function configFor(stateDir: string): Config {
  return {
    repos: [{ repo: "acme/app", events: ["workflow_run"], intervalMs: 60_000, checkRefLimit: 5 }],
    orgs: [],
    stateDir,
  };
}

function subscribe(socketPath: string, message: unknown): { socket: Socket; lines: any[] } {
  const socket = connect(socketPath);
  const lines: any[] = [];
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
      lines.push(JSON.parse(buffer.slice(0, index)));
      buffer = buffer.slice(index + 1);
    }
  });
  socket.write(`${JSON.stringify(message)}\n`);
  return { socket, lines };
}

async function withHistory(
  check: (socketPath: string, gh: FakeGitHub, startedAt: string) => Promise<void>,
): Promise<void> {
  const stateDir = tempStateDir();
  const gh = new FakeGitHub({ [RUNS]: { workflow_runs: [run(7, "in_progress", null)] } });
  const daemon = await startDaemon(configFor(stateDir), {
    gh,
    socketPath: join(stateDir, "pollhook.sock"),
    watch: false,
  });
  try {
    await pause(150);
    const startedAt = new Date(Date.now() - 1000).toISOString();
    gh.respond(RUNS, { workflow_runs: [run(7, "completed", "success")] });
    await rpcTo(daemon.socketPath, { op: "poke", repo: "acme/app" });
    await pause(200);
    await check(daemon.socketPath, gh, startedAt);
  } finally {
    await daemon.close();
  }
}

test("a subscriber that passes since gets the deliveries it missed, then live ones", async () => {
  await withHistory(async (socketPath, gh, startedAt) => {
    const { socket, lines } = subscribe(socketPath, { op: "emit", since: startedAt });
    await pause(150);

    assert.equal(lines[0].body.subscribed, true);
    const replayed = lines.slice(1).map((entry) => entry.body);
    assert.equal(replayed.length, 1);
    assert.equal(replayed[0].event, "workflow_run");
    assert.equal(replayed[0].action, "completed");

    gh.respond(RUNS, {
      workflow_runs: [run(7, "completed", "success"), run(8, "in_progress", null)],
    });
    await rpcTo(socketPath, { op: "poke", repo: "acme/app" });
    await pause(200);

    const ids = lines.slice(1).map((entry) => entry.body.id);
    assert.equal(ids.length, 2, "one replayed and one live");
    assert.equal(new Set(ids).size, 2, "no delivery arrives twice");
    socket.destroy();
  });
});

test("a subscriber without since gets only live deliveries", async () => {
  await withHistory(async (socketPath) => {
    const { socket, lines } = subscribe(socketPath, { op: "emit" });
    await pause(150);

    assert.equal(lines.length, 1);
    assert.equal(lines[0].body.subscribed, true);
    socket.destroy();
  });
});

test("a since in the future replays nothing and a bad since is rejected", async () => {
  await withHistory(async (socketPath) => {
    const future = subscribe(socketPath, {
      op: "emit",
      since: new Date(Date.now() + 60_000).toISOString(),
    });
    await pause(150);
    assert.equal(future.lines.length, 1);
    future.socket.destroy();

    const bad = await rpcTo(socketPath, { op: "emit", since: "yesterday-ish" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /since must be an ISO timestamp/);
  });
});

test("a real emit process survives a daemon restart and prints the missed delivery once", async () => {
  const stateDir = tempStateDir();
  const socketPath = join(stateDir, "pollhook.sock");
  const configPath = join(stateDir, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({ repos: [{ repo: "acme/app", events: ["workflow_run"] }], stateDir }),
  );
  const first = await startDaemon(configFor(stateDir), {
    gh: new FakeGitHub({ [RUNS]: { workflow_runs: [run(7, "in_progress", null)] } }),
    socketPath,
    watch: false,
  });
  await pause(150);

  const child = spawn(process.execPath, ["src/cli.ts", "emit", "--brief"], {
    cwd: join(import.meta.dirname, ".."),
    env: { ...process.env, POLLHOOK_CONFIG: configPath, XDG_RUNTIME_DIR: stateDir },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  await pause(500);

  await first.close();
  const second = await startDaemon(configFor(stateDir), {
    gh: new FakeGitHub({ [RUNS]: { workflow_runs: [run(7, "completed", "success")] } }),
    socketPath,
    watch: false,
  });
  try {
    for (let waited = 0; waited < 8000 && !stdout.includes("completed"); waited += 100) {
      await pause(100);
    }
    await pause(1500);

    assert.equal(stdout.trim().split("\n").length, 1, `printed once, got: ${stdout}`);
    assert.match(stdout, /acme\/app workflow_run completed/);
    assert.match(stderr, /connection lost/);
    assert.match(stderr, /reconnected/);
  } finally {
    child.kill("SIGKILL");
    await second.close();
  }
});
