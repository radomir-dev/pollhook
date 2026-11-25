import { readFileSync } from "node:fs";
import { IMPLEMENTED_EVENTS } from "./registry.ts";
import type { EventName } from "./types.ts";
import { errorMessage, expandHome } from "./util.ts";

export interface RepoConfig {
  repo: string;
  events: EventName[];
  intervalMs: number;
  checkRefLimit: number;
}

export interface DeliverConfig {
  url: string;
  secret?: string;
}

export interface Config {
  repos: RepoConfig[];
  stateDir: string;
  deliver?: DeliverConfig;
}

const DEFAULT_CONFIG = "~/.config/pollhook/config.json";
const DEFAULT_STATE = "~/.local/state/pollhook";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function configPath(override?: string): string {
  return expandHome(override ?? process.env.POLLHOOK_CONFIG ?? DEFAULT_CONFIG);
}

export function loadConfig(override?: string): Config {
  const path = configPath(override);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read config ${path}: ${errorMessage(error)}`);
  }
  if (!isRecord(raw)) throw new Error(`config ${path} must be a JSON object`);
  if (!Array.isArray(raw.repos) || raw.repos.length === 0) {
    throw new Error(`config ${path}: repos must be a non-empty array`);
  }
  const repos = raw.repos.map((entry, index) => parseRepo(entry, index, path));
  const stateDir = expandHome(typeof raw.stateDir === "string" ? raw.stateDir : DEFAULT_STATE);
  const deliver = raw.deliver === undefined ? undefined : parseDeliver(raw.deliver, path);
  return { repos, stateDir, ...(deliver ? { deliver } : {}) };
}

function parseRepo(value: unknown, index: number, path: string): RepoConfig {
  if (!isRecord(value)) throw new Error(`config ${path}: repos[${index}] must be an object`);
  const repo = value.repo;
  if (typeof repo !== "string" || !REPO_PATTERN.test(repo)) {
    throw new Error(`config ${path}: repos[${index}].repo must look like owner/name`);
  }
  let events: EventName[] = [...IMPLEMENTED_EVENTS];
  if (value.events !== undefined) {
    if (!Array.isArray(value.events) || value.events.length === 0) {
      throw new Error(`config ${path}: repos[${index}].events must be a non-empty array`);
    }
    for (const event of value.events) {
      if (!IMPLEMENTED_EVENTS.includes(event as EventName)) {
        throw new Error(
          `config ${path}: unknown event "${event}" in repos[${index}]; supported: ${IMPLEMENTED_EVENTS.join(", ")}`,
        );
      }
    }
    events = value.events as EventName[];
  }
  const intervalSeconds = positiveNumber(value.intervalSeconds, 60);
  if (intervalSeconds < 5) throw new Error(`config ${path}: repos[${index}].intervalSeconds must be at least 5`);
  return {
    repo,
    events,
    intervalMs: intervalSeconds * 1000,
    checkRefLimit: positiveNumber(value.checkRefLimit, 5),
  };
}

function parseDeliver(value: unknown, path: string): DeliverConfig {
  if (!isRecord(value) || typeof value.url !== "string") {
    throw new Error(`config ${path}: deliver.url is required`);
  }
  let url: URL;
  try {
    url = new URL(value.url);
  } catch {
    throw new Error(`config ${path}: deliver.url is not a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`config ${path}: deliver.url must be http or https`);
  }
  if (!LOOPBACK.has(url.hostname)) {
    throw new Error(`config ${path}: deliver.url must be loopback, got ${url.hostname}`);
  }
  if (value.secret !== undefined && typeof value.secret !== "string") {
    throw new Error(`config ${path}: deliver.secret must be a string`);
  }
  return value.secret === undefined ? { url: value.url } : { url: value.url, secret: value.secret };
}

function positiveNumber(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`expected a positive number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
