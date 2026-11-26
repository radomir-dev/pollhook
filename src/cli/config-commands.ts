import { existsSync } from "node:fs";
import { configPath, loadConfig } from "../config.ts";
import {
  addRepo,
  DEFAULT_EVENTS,
  readRaw,
  removeRepo,
  saveConfig,
  starterConfig,
} from "../config/edit.ts";
import { positionals, required, valueFlag, values } from "./args.ts";
import { findUnknownKeys } from "../config/schema.ts";
import { configReport } from "./config-report.ts";

const PLACEHOLDER = "owner/name";

export function runConfigCommand(command: string, args: string[]): number | undefined {
  if (command === "init") return initCommand(args);
  if (command !== "config") return undefined;
  const [action, ...rest] = positionals(args);
  const handler = ACTIONS[action ?? ""];
  if (!handler) throw new Error("config needs one of: check, add-repo, remove-repo");
  return handler(rest, args);
}

const ACTIONS: Record<string, (rest: string[], args: string[]) => number> = {
  check: checkCommand,
  "add-repo": addRepoCommand,
  "remove-repo": removeRepoCommand,
};

function eventsFrom(args: string[]): string[] {
  const events = valueFlag(args, "--events");
  return events ? events.split(",").map((event) => event.trim()) : DEFAULT_EVENTS;
}

function initCommand(args: string[]): number {
  const path = configPath(valueFlag(args, "--config"));
  if (existsSync(path) && !args.includes("--force")) {
    throw new Error(`${path} already exists; pass --force to overwrite it`);
  }
  const repos = values(args, "--repo");
  saveConfig(path, starterConfig(repos.length > 0 ? repos : [PLACEHOLDER], eventsFrom(args)));
  process.stdout.write(`wrote ${path}\n`);
  if (repos.length === 0)
    process.stdout.write(`edit it: replace ${PLACEHOLDER} with a repository\n`);
  process.stdout.write("next: pollhook status\n");
  return 0;
}

function checkCommand(_rest: string[], args: string[]): number {
  const override = valueFlag(args, "--config");
  const config = loadConfig(override);
  for (const key of findUnknownKeys(readRaw(configPath(override)))) {
    process.stderr.write(`warning: "${key}" is not a known key and is ignored\n`);
  }
  process.stdout.write(`${configPath(override)} is valid\n${configReport(config).join("\n")}\n`);
  return 0;
}

function addRepoCommand(rest: string[], args: string[]): number {
  const path = configPath(valueFlag(args, "--config"));
  const repo = required(rest[0], "repository (OWNER/NAME)");
  const interval = valueFlag(args, "--interval");
  saveConfig(
    path,
    addRepo(readRaw(path), repo, eventsFrom(args), interval ? Number(interval) : undefined),
  );
  process.stdout.write(`added ${repo} to ${path}\n`);
  return 0;
}

function removeRepoCommand(rest: string[], args: string[]): number {
  const path = configPath(valueFlag(args, "--config"));
  const repo = required(rest[0], "repository (OWNER/NAME)");
  saveConfig(path, removeRepo(readRaw(path), repo));
  process.stdout.write(`removed ${repo} from ${path}\n`);
  return 0;
}
