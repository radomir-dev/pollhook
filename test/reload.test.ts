import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, type Socket } from "node:net";
import test from "node:test";
import { startDaemon } from "../src/daemon.ts";
import type { Config } from "../src/config.ts";
import { FakeGitHub, rpcTo, tempStateDir } from "./helpers.ts";

function configFile(stateDir: string, repos: string[]): string {
  const path = join(stateDir, "config.json");
  const raw = {
    repos: repos.map((repo) => ({ repo, events: ["workflow_run"] })),
    stateDir,
  };
  writeFileSync(path, JSON.stringify(raw));
  return path;
}

function configFor(stateDir: string, repos: string[]): Config {
  return {
    repos: repos.map((repo) => ({
      repo,
      events: ["workflow_run"],
      intervalMs: 60_000,
      checkRefLimit: 5,
    })),
    orgs: [],
    stateDir,
  };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function request(socket: Socket, message: unknown): void {
  socket.write(`${JSON.stringify(message)}\n`);
}

function nextLine(socket: Socket): Promise<any> {
  return new Promise((resolve) =>
    socket.once("data", (chunk) => resolve(JSON.parse(String(chunk).trim()))),
  );
}

test("SIGHUP reloads the config without closing an open connection", async () => {
  const stateDir = tempStateDir();
  const path = configFile(stateDir, ["acme/app"]);
  const daemon = await startDaemon(configFor(stateDir, ["acme/app"]), {
    gh: new FakeGitHub({}),
    socketPath: join(stateDir, "test.sock"),
    configPath: path,
    watch: false,
  });
  const socket = connect(daemon.socketPath);
  socket.setEncoding("utf8");
  await new Promise((resolve) => socket.once("connect", resolve));

  try {
    request(socket, { op: "status" });
    const before = await nextLine(socket);
    assert.equal(before.body.repos.length, 1);

    configFile(stateDir, ["acme/app", "acme/lib"]);
    process.emit("SIGHUP");
    await pause(50);

    request(socket, { op: "status" });
    const after = await nextLine(socket);
    assert.equal(after.body.repos.length, 2);
    assert.ok(after.body.configReloadedAt);
    assert.equal(after.body.configError, null);
  } finally {
    socket.destroy();
    await daemon.close();
  }
});

test("a broken config is reported and the old one keeps running", async () => {
  const stateDir = tempStateDir();
  const path = configFile(stateDir, ["acme/app"]);
  const daemon = await startDaemon(configFor(stateDir, ["acme/app"]), {
    gh: new FakeGitHub({}),
    socketPath: join(stateDir, "test.sock"),
    configPath: path,
    watch: false,
  });
  try {
    writeFileSync(path, JSON.stringify({ repos: [] }));
    process.emit("SIGHUP");
    await pause(50);

    const status = await rpcTo(daemon.socketPath, { op: "status" });
    assert.equal(status.body.repos.length, 1);
    assert.match(status.body.configError, /at least one of repos or orgs is required/);
  } finally {
    await daemon.close();
  }
});
