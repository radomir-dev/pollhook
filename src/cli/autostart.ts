import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import type { Socket } from "node:net";
import { join } from "node:path";
import type { Config } from "../config.ts";
import { socketPathFor } from "../daemon.ts";
import { sleep } from "../util.ts";
import { connectSocket, DaemonUnreachable } from "./socket.ts";

const IDLE_EXIT = "30m";
const START_TIMEOUT_MS = 5000;
const START_POLL_MS = 100;

const autostartDisabled = (): boolean => process.env.POLLHOOK_NO_AUTOSTART === "1";

export async function connectDaemon(config: Config, autostart = true): Promise<Socket> {
  const path = socketPathFor(config);
  try {
    return await connectSocket(path);
  } catch (error) {
    if (!(error instanceof DaemonUnreachable) || !autostart || autostartDisabled()) throw error;
  }
  const logPath = spawnDaemon(config);
  return waitForSocket(path, logPath);
}

function spawnDaemon(config: Config): string {
  mkdirSync(config.stateDir, { recursive: true });
  const logPath = join(config.stateDir, "daemon.log");
  const log = openSync(logPath, "a");
  const args = [...process.execArgv, process.argv[1]!, "daemon", "--idle-exit", IDLE_EXIT];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", log, log],
    env: process.env,
  });
  child.unref();
  closeSync(log);
  process.stderr.write(`pollhook: started the daemon (pid ${child.pid}, log ${logPath})\n`);
  return logPath;
}

async function waitForSocket(path: string, logPath: string): Promise<Socket> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(START_POLL_MS);
    try {
      return await connectSocket(path);
    } catch {}
  }
  throw new Error(`the daemon did not come up within ${START_TIMEOUT_MS / 1000}s; see ${logPath}`);
}
