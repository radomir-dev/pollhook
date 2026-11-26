import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "vitest";
import type { Config } from "../src/config.ts";
import { startDaemon } from "../src/daemon.ts";
import { FakeGitHub, rpcTo, tempStateDir } from "./helpers.ts";

function configFor(stateDir: string): Config {
  return {
    repos: [{ repo: "acme/app", events: ["workflow_run"], intervalMs: 60_000, checkRefLimit: 5 }],
    orgs: [],
    stateDir,
  };
}

async function withDaemon(run: (socketPath: string) => Promise<void>): Promise<void> {
  const stateDir = tempStateDir();
  const daemon = await startDaemon(configFor(stateDir), {
    gh: new FakeGitHub({}),
    socketPath: join(stateDir, "pollhook.sock"),
    watch: false,
  });
  try {
    await run(daemon.socketPath);
    const status = await rpcTo(daemon.socketPath, { op: "status" });
    assert.equal(status.ok, true, "the daemon is still answering");
  } finally {
    await daemon.close();
  }
}

test("a wait for an event without a match object times out instead of crashing the daemon", async () => {
  await withDaemon(async (socketPath) => {
    const reply = await rpcTo(socketPath, {
      op: "wait",
      timeoutMs: 300,
      request: { kind: "event", event: "push" },
    });

    assert.equal(reply.exitCode, 8);
  });
});

test("an unknown wait kind is rejected with an error", async () => {
  await withDaemon(async (socketPath) => {
    const reply = await rpcTo(socketPath, { op: "wait", request: { kind: "nonsense" } });

    assert.equal(reply.ok, false);
    assert.match(reply.error, /unknown wait kind nonsense/);
  });
});

test("a request that throws inside the daemon is answered with an error", async () => {
  await withDaemon(async (socketPath) => {
    const reply = await rpcTo(socketPath, { op: "deliveries", limit: { not: "a number" } });

    assert.equal(reply.ok, false);
    assert.match(reply.error, /request failed/);
  });
});
