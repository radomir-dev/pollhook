import { readFileSync } from "node:fs";
import { implementedEvents } from "./registry.ts";
import { EVENTS_DOC_URL, MIN_INTERVAL_SECONDS, missingConfigMessage } from "./config/help.ts";
import { parseTuning, type EventTuning } from "./config/tuning.ts";
import type { AdapterScope, EventName } from "./types.ts";
import { errorMessage, expandHome } from "./util.ts";

interface RepoConfig extends EventTuning {
  repo: string;
  events: EventName[];
  intervalMs: number;
  checkRefLimit: number;
}

interface OrgConfig extends EventTuning {
  org: string;
  events: EventName[];
  intervalMs: number;
}

export interface DeliverConfig {
  url: string;
  secret?: string;
}

export interface Config extends EventTuning {
  repos: RepoConfig[];
  orgs: OrgConfig[];
  stateDir: string;
  deliver?: DeliverConfig;
}

const DEFAULT_CONFIG = "~/.config/pollhook/config.json";
const DEFAULT_STATE = "~/.local/state/pollhook";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const ORG_PATTERN = /^[A-Za-z0-9_.-]+$/;

export function configPath(override?: string): string {
  return expandHome(override ?? process.env.POLLHOOK_CONFIG ?? DEFAULT_CONFIG);
}

export function loadConfig(override?: string): Config {
  const path = configPath(override);
  return parseConfig(readConfigFile(path), path);
}

function readConfigFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(missingConfigMessage(path));
    throw new Error(`cannot read config ${path}: ${errorMessage(error)}`);
  }
}

export function parseConfig(raw: unknown, path: string): Config {
  if (!isRecord(raw)) throw new Error(`config ${path} must be a JSON object`);

  const reposRaw = raw.repos ?? [];
  const orgsRaw = raw.orgs ?? [];
  if (!Array.isArray(reposRaw)) throw new Error(`config ${path}: repos must be an array`);
  if (!Array.isArray(orgsRaw)) throw new Error(`config ${path}: orgs must be an array`);
  const repos = reposRaw.map((entry, index) => parseRepo(entry, index, path));
  const orgs = orgsRaw.map((entry, index) => parseOrg(entry, index, path));
  if (repos.length === 0 && orgs.length === 0) {
    throw new Error(`config ${path}: at least one of repos or orgs is required`);
  }

  const stateDir = expandHome(typeof raw.stateDir === "string" ? raw.stateDir : DEFAULT_STATE);
  const deliver = raw.deliver === undefined ? undefined : parseDeliver(raw.deliver, path);
  const tuning = parseTuning(raw, path, "config", implementedEvents("repo"));
  return { repos, orgs, stateDir, ...tuning, ...(deliver ? { deliver } : {}) };
}

function parseRepo(value: unknown, index: number, path: string): RepoConfig {
  if (!isRecord(value)) throw new Error(`config ${path}: repos[${index}] must be an object`);
  const repo = value.repo;
  if (typeof repo !== "string" || !REPO_PATTERN.test(repo)) {
    throw new Error(`config ${path}: repos[${index}].repo must look like owner/name`);
  }
  const intervalSeconds = intervalFor(value.intervalSeconds, 60, path, `repos[${index}]`);
  const events = parseEvents(value.events, index, path, "repos", "repo");
  return {
    repo,
    events,
    intervalMs: intervalSeconds * 1000,
    checkRefLimit: positiveNumber(value.checkRefLimit, 5),
    ...parseTuning(value, path, `repos[${index}]`, events),
  };
}

function parseOrg(value: unknown, index: number, path: string): OrgConfig {
  if (!isRecord(value)) throw new Error(`config ${path}: orgs[${index}] must be an object`);
  const org = value.org;
  if (typeof org !== "string" || !ORG_PATTERN.test(org)) {
    throw new Error(`config ${path}: orgs[${index}].org must be an organization name`);
  }
  const intervalSeconds = intervalFor(value.intervalSeconds, 300, path, `orgs[${index}]`);
  const events = parseEvents(value.events, index, path, "orgs", "org");
  return {
    org,
    events,
    intervalMs: intervalSeconds * 1000,
    ...parseTuning(value, path, `orgs[${index}]`, events),
  };
}

function parseEvents(
  value: unknown,
  index: number,
  path: string,
  group: string,
  scope: AdapterScope,
): EventName[] {
  const allowed = implementedEvents(scope);
  if (value === undefined) return [...allowed];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`config ${path}: ${group}[${index}].events must be a non-empty array`);
  }
  for (const event of value) {
    if (!allowed.includes(event as EventName)) {
      throw new Error(
        `config ${path}: event "${event}" is not available for ${scope} targets; supported: ${allowed.join(", ") || "none"}\nwhat each event reports: ${EVENTS_DOC_URL}`,
      );
    }
  }
  return value as EventName[];
}

function intervalFor(value: unknown, fallback: number, path: string, label: string): number {
  const seconds = positiveNumber(value, fallback);
  if (seconds < MIN_INTERVAL_SECONDS) {
    throw new Error(
      `config ${path}: ${label}.intervalSeconds must be at least ${MIN_INTERVAL_SECONDS}`,
    );
  }
  return seconds;
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
