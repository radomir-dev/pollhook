import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function holderOf(path: string): number | null {
  const pid = Number(readFileSync(path, "utf8"));
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function createLock(path: string): boolean {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, String(process.pid));
  try {
    linkSync(temp, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    rmSync(temp, { force: true });
  }
}

export function acquireLock(stateDir: string): () => void {
  mkdirSync(stateDir, { recursive: true });
  const path = join(stateDir, "daemon.lock");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (createLock(path)) return () => release(path);
    const holder = holderOf(path);
    if (holder && isAlive(holder)) {
      throw new Error(`another pollhook (pid ${holder}) is using ${stateDir}`);
    }
    rmSync(path, { force: true });
  }
  throw new Error(`could not take the pollhook lock in ${stateDir}`);
}

function release(path: string): void {
  try {
    if (holderOf(path) === process.pid) rmSync(path, { force: true });
  } catch {}
}
