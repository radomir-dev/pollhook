import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { createIdleExit } from "../src/daemon/idle.ts";
import { acquireLock } from "../src/daemon/lock.ts";
import { tempStateDir } from "./helpers.ts";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the lock is held by one process at a time and released on request", () => {
  const dir = tempStateDir();
  const release = acquireLock(dir);

  assert.throws(() => acquireLock(dir), new RegExp(`another pollhook \\(pid ${process.pid}\\)`));
  release();
  assert.equal(existsSync(join(dir, "daemon.lock")), false);
  acquireLock(dir)();
});

test("a lock left by a dead process is taken over", async () => {
  const dir = tempStateDir();
  const child = spawn(process.execPath, ["-e", ""]);
  await new Promise((resolve) => child.on("close", resolve));
  writeFileSync(join(dir, "daemon.lock"), String(child.pid));

  const release = acquireLock(dir);

  assert.equal(readFileSync(join(dir, "daemon.lock"), "utf8"), String(process.pid));
  release();
});

test("releasing never removes a lock that belongs to someone else", () => {
  const dir = tempStateDir();
  const release = acquireLock(dir);
  writeFileSync(join(dir, "daemon.lock"), String(process.ppid));

  release();

  assert.equal(readFileSync(join(dir, "daemon.lock"), "utf8"), String(process.ppid));
});

test("idle exit fires after a quiet period, a connection cancels it, stop silences it for good", async () => {
  let fired = 0;
  const idle = createIdleExit(40, () => (fired += 1));

  idle.quiet();
  idle.connected();
  await pause(80);
  assert.equal(fired, 0, "a connection cancels the timer");

  idle.quiet();
  await pause(80);
  assert.equal(fired, 1, "quiet for the whole period fires once");

  idle.quiet();
  idle.stop();
  idle.quiet();
  await pause(80);
  assert.equal(fired, 1, "after stop nothing re-arms it");
});

test("without an idle period the timer never starts", async () => {
  let fired = 0;
  const idle = createIdleExit(undefined, () => (fired += 1));

  idle.quiet();
  await pause(50);

  assert.equal(fired, 0);
});
