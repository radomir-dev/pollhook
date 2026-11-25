import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseConfig } from "../config.ts";

type Raw = Record<string, any>;

export const DEFAULT_EVENTS = ["workflow_run", "pull_request"];

export function starterConfig(repos: string[], events: string[]): Raw {
  return { repos: repos.map((repo) => ({ repo, events })) };
}

export function readRaw(path: string): Raw {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`config ${path} must be a JSON object`);
  }
  return raw as Raw;
}

export function addRepo(raw: Raw, repo: string, events: string[], intervalSeconds?: number): Raw {
  const repos: Raw[] = Array.isArray(raw.repos) ? raw.repos : [];
  if (repos.some((entry) => entry.repo === repo)) throw new Error(`${repo} is already configured`);
  const entry: Raw = { repo, events };
  if (intervalSeconds !== undefined) entry.intervalSeconds = intervalSeconds;
  return { ...raw, repos: [...repos, entry] };
}

export function removeRepo(raw: Raw, repo: string): Raw {
  const repos: Raw[] = Array.isArray(raw.repos) ? raw.repos : [];
  if (!repos.some((entry) => entry.repo === repo)) throw new Error(`${repo} is not configured`);
  return { ...raw, repos: repos.filter((entry) => entry.repo !== repo) };
}

export function saveConfig(path: string, raw: Raw): void {
  parseConfig(raw, path);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(raw, null, 2)}\n`);
  renameSync(temp, path);
}
