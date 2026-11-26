import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "vitest";
import { tempStateDir } from "./helpers.ts";

const root = join(import.meta.dirname, "..");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Setup {
  stateDir: string;
  configPath: string;
  env: Record<string, string>;
  close(): Promise<void>;
}

async function setup(extraConfig: Record<string, unknown> = {}): Promise<Setup> {
  const api = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"workflow_runs":[]}');
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const stateDir = tempStateDir();
  const configPath = join(stateDir, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      repos: [{ repo: "acme/app", events: ["workflow_run"] }],
      stateDir,
      ...extraConfig,
    }),
  );
  const env = {
    POLLHOOK_CONFIG: configPath,
    XDG_RUNTIME_DIR: stateDir,
    POLLHOOK_TOKEN: "test",
    POLLHOOK_API_URL: `http://127.0.0.1:${(api.address() as AddressInfo).port}`,
    POLLHOOK_NO_AUTOSTART: "0",
  };
  return {
    stateDir,
    configPath,
    env,
    close: () => new Promise((resolve) => api.close(() => resolve())),
  };
}

function cli(
  args: string[],
  env: Record<string, string>,
): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["src/cli.ts", ...args], {
      cwd: root,
      env: { ...process.env, ...env },
    });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (out += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (err += chunk));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

const pidOf = (output: string): number => Number(/pid (\d+)/.exec(output)?.[1]);

async function until(condition: () => boolean, ms = 5000): Promise<boolean> {
  for (let waited = 0; waited < ms; waited += 50) {
    if (condition()) return true;
    await pause(50);
  }
  return condition();
}

function startDaemon(args: string[], env: Record<string, string>): ChildProcess {
  return spawn(process.execPath, ["src/cli.ts", "daemon", ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
}

test("a command starts the daemon when none runs, and stop shuts it down", async () => {
  const s = await setup();
  try {
    const first = await cli(["status"], s.env);
    assert.equal(first.code, 0, first.err);
    assert.match(first.err, /started the daemon \(pid \d+, log .*daemon\.log\)/);

    const second = await cli(["status"], s.env);
    assert.doesNotMatch(second.err, /started the daemon/);
    assert.equal(pidOf(second.out), pidOf(first.out), "the same daemon answers");

    const stopped = await cli(["stop"], s.env);
    assert.match(stopped.out, /stopped pollhook/);
    assert.ok(await until(() => !existsSync(join(s.stateDir, "pollhook.sock"))), "socket removed");
    assert.ok(await until(() => !existsSync(join(s.stateDir, "daemon.lock"))), "lock removed");

    const again = await cli(["stop"], s.env);
    assert.equal(again.code, 0);
    assert.match(again.out, /not running/);
  } finally {
    await cli(["stop"], { ...s.env, POLLHOOK_NO_AUTOSTART: "1" });
    await s.close();
  }
});

test("ten commands started at once leave exactly one daemon", async () => {
  const s = await setup();
  try {
    const results = await Promise.all(Array.from({ length: 10 }, () => cli(["status"], s.env)));

    for (const result of results) assert.equal(result.code, 0, result.err);
    assert.equal(new Set(results.map((result) => pidOf(result.out))).size, 1);
  } finally {
    await cli(["stop"], s.env);
    await s.close();
  }
});

test("autostart can be switched off by environment or by flag", async () => {
  const s = await setup();
  try {
    const byEnv = await cli(["status"], { ...s.env, POLLHOOK_NO_AUTOSTART: "1" });
    const byFlag = await cli(["status", "--no-autostart"], s.env);

    for (const result of [byEnv, byFlag]) {
      assert.equal(result.code, 2);
      assert.match(result.err, /cannot reach pollhook/);
      assert.doesNotMatch(result.err, /started the daemon/);
    }
  } finally {
    await s.close();
  }
});

test("a daemon with --idle-exit leaves after the idle period, one with a deliver target stays", async () => {
  const idle = await setup();
  const staying = await setup({ deliver: { url: "http://127.0.0.1:9/hook" } });
  const leaving = startDaemon(["--idle-exit", "1s"], idle.env);
  const kept = startDaemon(["--idle-exit", "1s"], staying.env);
  try {
    assert.ok(await until(() => existsSync(join(idle.stateDir, "pollhook.sock"))));
    assert.ok(await until(() => existsSync(join(staying.stateDir, "pollhook.sock"))));
    await cli(["status"], { ...idle.env, POLLHOOK_NO_AUTOSTART: "1" });

    assert.ok(await until(() => leaving.exitCode === 0, 5000), "the idle daemon exits");
    assert.equal(kept.exitCode, null, "the daemon with deliver.url keeps running");
  } finally {
    await cli(["stop"], { ...staying.env, POLLHOOK_NO_AUTOSTART: "1" });
    leaving.kill("SIGKILL");
    kept.kill("SIGKILL");
    await idle.close();
    await staying.close();
  }
});

test("a second daemon on the same state is refused even with another socket", async () => {
  const s = await setup();
  const first = startDaemon([], s.env);
  try {
    assert.ok(await until(() => existsSync(join(s.stateDir, "pollhook.sock"))));
    const otherRuntime = tempStateDir();
    let stderr = "";
    const second = startDaemon([], { ...s.env, XDG_RUNTIME_DIR: otherRuntime });
    second.stderr!.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const code = await new Promise<number | null>((resolve) => second.on("close", resolve));

    assert.equal(code, 2);
    assert.match(stderr, /another pollhook \(pid \d+\) is using/);
  } finally {
    await cli(["stop"], s.env);
    first.kill("SIGKILL");
    await s.close();
  }
});
