import type { Config } from "../config.ts";
import type { EventName } from "../types.ts";
import type { WaitRequest } from "../waits.ts";
import { parseDuration, positionals, required, valueFlag, values } from "./args.ts";
import { rpc, type RpcResponse } from "./rpc.ts";
import { USAGE } from "./usage.ts";

type Handler = (config: Config, args: string[]) => Promise<number>;
type Until = "merged" | "closed" | "reviewed" | "conflict";

const UNTIL = new Set(["merged", "closed", "reviewed", "conflict"]);

const handlers: Record<string, Handler> = {
  status: statusCommand,
  events: eventsCommand,
  deliveries: deliveriesCommand,
  run: runCommand,
  checks: checksCommand,
  pr: prCommand,
  pages: pagesCommand,
  wait: waitCommand,
  cleanup: cleanupCommand,
  poke: pokeCommand,
};

export async function dispatchCommand(
  config: Config,
  command: string,
  args: string[],
): Promise<number> {
  const handler = handlers[command];
  if (!handler) {
    process.stderr.write(`unknown command ${command}\n\n${USAGE}`);
    return 2;
  }
  return handler(config, args);
}

async function statusCommand(config: Config, args: string[]): Promise<number> {
  const body = unwrap(await rpc(config, { op: "status" }));
  if (args.includes("--json")) process.stdout.write(`${JSON.stringify(body)}\n`);
  else printStatus(body);
  return 0;
}

async function eventsCommand(config: Config): Promise<number> {
  const body = unwrap(await rpc(config, { op: "events" })) as Array<{
    event: string;
    intervalFloorSeconds: number;
  }>;
  for (const event of body) {
    process.stdout.write(`${event.event}\t${event.intervalFloorSeconds}s\n`);
  }
  return 0;
}

async function deliveriesCommand(config: Config, args: string[]): Promise<number> {
  const body = unwrap(
    await rpc(config, {
      op: "deliveries",
      limit: Number(valueFlag(args, "--limit") ?? 20),
      repo: valueFlag(args, "--repo"),
    }),
  ) as unknown[];
  for (const delivery of body) process.stdout.write(`${JSON.stringify(delivery)}\n`);
  return 0;
}

async function runCommand(config: Config, args: string[]): Promise<number> {
  const id = required(positionals(args)[0], "run id");
  const request: WaitRequest = { kind: "run", repo: repoFor(config, args), id };
  return finishWait(await waitFor(config, request, args));
}

async function checksCommand(config: Config, args: string[]): Promise<number> {
  const pr = Number(required(positionals(args)[0], "pull request number"));
  const request: WaitRequest = { kind: "checks", repo: repoFor(config, args), pr };
  return finishWait(await waitFor(config, request, args));
}

async function prCommand(config: Config, args: string[]): Promise<number> {
  const pr = Number(required(positionals(args)[0], "pull request number"));
  const request: WaitRequest = {
    kind: "pr",
    repo: repoFor(config, args),
    pr,
    until: untilFlag(args),
  };
  return finishWait(await waitFor(config, request, args));
}

async function pagesCommand(config: Config, args: string[]): Promise<number> {
  const sha = required(positionals(args)[0], "commit sha");
  const request: WaitRequest = { kind: "pages", repo: repoFor(config, args), sha };
  return finishWait(await waitFor(config, request, args));
}

async function waitCommand(config: Config, args: string[]): Promise<number> {
  const event = valueFlag(args, "--event") as EventName | undefined;
  if (!event) throw new Error("--event is required");
  const request: WaitRequest = {
    kind: "event",
    repo: valueFlag(args, "--repo"),
    event,
    match: parseMatches(args),
  };
  return finishWait(await waitFor(config, request, args));
}

async function pokeCommand(config: Config, args: string[]): Promise<number> {
  unwrap(await rpc(config, { op: "poke", repo: valueFlag(args, "--repo") }));
  return 0;
}

function cleanupCommand(): Promise<number> {
  process.stdout.write("pollhook creates no GitHub webhooks; nothing to clean up\n");
  return Promise.resolve(0);
}

function untilFlag(args: string[]): Until {
  const until = valueFlag(args, "--until");
  if (!until || !UNTIL.has(until)) {
    throw new Error("--until must be one of merged, closed, reviewed, conflict");
  }
  return until as Until;
}

function parseMatches(args: string[]): Record<string, string> {
  const match: Record<string, string> = {};
  for (const pair of values(args, "--match")) {
    const [key, ...rest] = pair.split("=");
    if (!key || rest.length === 0) throw new Error(`--match must look like key=value, got ${pair}`);
    match[key] = rest.join("=");
  }
  return match;
}

async function waitFor(config: Config, request: WaitRequest, args: string[]): Promise<RpcResponse> {
  return rpc(config, {
    op: "wait",
    request,
    timeoutMs: parseDuration(valueFlag(args, "--timeout"), 30 * 60_000),
  });
}

function finishWait(response: RpcResponse): number {
  process.stdout.write(`${JSON.stringify(unwrap(response))}\n`);
  return response.exitCode ?? 2;
}

function unwrap(response: RpcResponse): any {
  if (!response.ok) throw new Error(response.error ?? "request failed");
  return response.body;
}

function repoFor(config: Config, args: string[]): string {
  const explicit = valueFlag(args, "--repo");
  if (explicit) return explicit;
  if (config.repos.length === 1) return config.repos[0]!.repo;
  throw new Error("multiple repositories configured: pass --repo");
}

function printStatus(body: any): void {
  for (const repo of body.repos) {
    const error = repo.lastError ? `  error=${repo.lastError}` : "";
    const degraded = repo.degraded?.length
      ? `  degraded=${repo.degraded.map((item: any) => item.event).join(",")}`
      : "";
    process.stdout.write(
      `${repo.repo}  events=${repo.events.length}  last_poll=${repo.lastPollAt ?? "-"}  next_poll=${repo.nextPollAt ?? "-"}  last_event=${repo.lastEventAt ?? "-"}${error}${degraded}\n`,
    );
  }
  process.stdout.write(
    `quota ${body.quota.remaining}/${body.quota.limit} remaining, resets ${body.quota.resetAt ?? "-"}\n`,
  );
  process.stdout.write(`deliveries ${body.deliveries}, waiters ${body.waiters}, pid ${body.pid}\n`);
}
