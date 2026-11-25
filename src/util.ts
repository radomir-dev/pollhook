import { createHash } from "node:crypto";
import { homedir } from "node:os";

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return `${homedir()}/${path.slice(2)}`;
  return path;
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function pick(value: unknown, path: string): unknown {
  let current: any = value;
  for (const part of path.split(".")) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isStatus(error: unknown, status: number): boolean {
  return error instanceof Error && error.message.startsWith(`${status} `);
}
