#!/usr/bin/env node
import { connect, type Socket } from "node:net";
import { loadConfig, type Config } from "./config.ts";
import { socketPathFor, startDaemon } from "./daemon.ts";
import type { EventName } from "./types.ts";
import { errorMessage } from "./util.ts";
import type { WaitRequest } from "./waits.ts";

const USAGE = `pollhook: GitHub webhook deliveries without webhooks

  pollhook daemon [--config PATH]
  pollhook status [--json]
  pollhook events
  pollhook deliveries [--limit N] [--repo OWNER/NAME]
  pollhook emit
  pollhook run <run-id> [--repo OWNER/NAME] [--timeout 30m]
  pollhook checks <pr> [--repo OWNER/NAME] [--timeout 30m]
  pollhook pr <pr> --until merged|closed|reviewed|conflict [--repo OWNER/NAME] [--timeout 30m]
  pollhook pages <sha> [--repo OWNER/NAME] [--timeout 30m]
  pollhook wait --event EVENT [--match key=value]... [--repo OWNER/NAME] [--timeout 30m]
  pollhook cleanup

Exit codes: 0 success, 1 failing conclusion, 8 timeout, 2 bad input or daemon unreachable.
`;

const VALUE_FLAGS = new Set([
  "--config",
  "--repo",
  "--timeout",
  "--until",
  "--limit",
  "--event",
  "--match",
]);

interface RpcResponse {
  ok: boolean;
  body?: any;
  error?: string;
  exitCode?: number;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }
  const config = loadConfig(valueFlag(args, "--config"));

  if (command === "daemon") {
    const daemon = await startDaemon(config);
    await daemon.closed;
    return 0;
  }
  if (command === "emit") {
    await stream(config, { op: "emit" });
    return 0;
  }

  const positional = positionals(args);
  switch (command) {
    case "status": {
      const response = await rpc(config, { op: "status" });
      const body = unwrap(response);
      if (args.includes("--json")) process.stdout.write(`${JSON.stringify(body)}\n`);
      else printStatus(body);
      return 0;
    }
    case "events": {
      const response = await rpc(config, { op: "events" });
      const body = unwrap(response) as Array<{ event: string; intervalFloorSeconds: number }>;
      for (const event of body) {
        process.stdout.write(`${event.event}\t${event.intervalFloorSeconds}s\n`);
      }
      return 0;
    }
    case "deliveries": {
      const response = await rpc(config, {
        op: "deliveries",
        limit: Number(valueFlag(args, "--limit") ?? 20),
        repo: valueFlag(args, "--repo"),
      });
      const body = unwrap(response) as unknown[];
      for (const delivery of body) process.stdout.write(`${JSON.stringify(delivery)}\n`);
      return 0;
    }
    case "run": {
      const id = required(positional[0], "run id");
      return finishWait(
        await wait(config, { kind: "run", repo: repoFor(config, args), id }, args),
      );
    }
    case "checks": {
      const pr = Number(required(positional[0], "pull request number"));
      return finishWait(
        await wait(config, { kind: "checks", repo: repoFor(config, args), pr }, args),
      );
    }
    case "pr": {
      const pr = Number(required(positional[0], "pull request number"));
      const until = valueFlag(args, "--until");
      if (until !== "merged" && until !== "closed" && until !== "reviewed" && until !== "conflict") {
        throw new Error("--until must be one of merged, closed, reviewed, conflict");
      }
      return finishWait(
        await wait(config, { kind: "pr", repo: repoFor(config, args), pr, until }, args),
      );
    }
    case "pages": {
      const sha = required(positional[0], "commit sha");
      return finishWait(
        await wait(config, { kind: "pages", repo: repoFor(config, args), sha }, args),
      );
    }
    case "wait": {
      const event = valueFlag(args, "--event") as EventName | undefined;
      if (!event) throw new Error("--event is required");
      const match: Record<string, string> = {};
      for (const pair of values(args, "--match")) {
        const [key, ...rest] = pair.split("=");
        if (!key || rest.length === 0) throw new Error(`--match must look like key=value, got ${pair}`);
        match[key] = rest.join("=");
      }
      return finishWait(
        await wait(config, { kind: "event", repo: valueFlag(args, "--repo"), event, match }, args),
      );
    }
    case "cleanup":
      process.stdout.write("pollhook creates no GitHub webhooks; nothing to clean up\n");
      return 0;
    default:
      process.stderr.write(`unknown command ${command}\n\n${USAGE}`);
      return 2;
  }
}

async function wait(
  config: Config,
  request: WaitRequest,
  args: string[],
): Promise<RpcResponse> {
  return rpc(config, {
    op: "wait",
    request,
    timeoutMs: parseDuration(valueFlag(args, "--timeout"), 30 * 60_000),
  });
}

function finishWait(response: RpcResponse): number {
  const body = unwrap(response);
  process.stdout.write(`${JSON.stringify(body)}\n`);
  return response.exitCode ?? 2;
}

function unwrap(response: RpcResponse): any {
  if (!response.ok) throw new Error(response.error ?? "request failed");
  return response.body;
}

async function rpc(config: Config, message: Record<string, unknown>): Promise<RpcResponse> {
  const socket = await connectSocket(socketPathFor(config));
  try {
    return await new Promise<RpcResponse>((resolve, reject) => {
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        const index = buffer.indexOf("\n");
        if (index < 0) return;
        try {
          resolve(JSON.parse(buffer.slice(0, index)) as RpcResponse);
        } catch (error) {
          reject(error);
        }
        socket.end();
      });
      socket.on("error", reject);
      socket.write(`${JSON.stringify(message)}\n`);
    });
  } finally {
    socket.destroy();
  }
}

async function stream(config: Config, message: Record<string, unknown>): Promise<void> {
  const socket = await connectSocket(socketPathFor(config));
  socket.setEncoding("utf8");
  let buffer = "";
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line) {
        const response = JSON.parse(line) as RpcResponse;
        if (response.body?.subscribed) continue;
        process.stdout.write(`${JSON.stringify(response.body)}\n`);
      }
      index = buffer.indexOf("\n");
    }
  });
  await new Promise<void>((resolve) => socket.on("close", () => resolve()));
}

function connectSocket(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    socket.once("connect", () => resolve(socket));
    socket.once("error", (error) =>
      reject(new Error(`cannot reach pollhook at ${path}: ${error.message}`)),
    );
  });
}

function repoFor(config: Config, args: string[]): string {
  const explicit = valueFlag(args, "--repo");
  if (explicit) return explicit;
  if (config.repos.length === 1) return config.repos[0]!.repo;
  throw new Error("multiple repositories configured: pass --repo");
}

function valueFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function values(args: string[], name: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === name && args[index + 1] !== undefined) result.push(args[index + 1]!);
  }
  return result;
}

function positionals(args: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (VALUE_FLAGS.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) continue;
    result.push(arg);
  }
  return result;
}

function parseDuration(value: string | undefined, fallbackMs: number): number {
  if (!value) return fallbackMs;
  const match = /^(\d+)(s|m|h)?$/.exec(value);
  if (!match) throw new Error(`invalid --timeout ${value}`);
  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  if (unit === "h") return amount * 3_600_000;
  if (unit === "m") return amount * 60_000;
  return amount * 1000;
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === "") throw new Error(`missing ${name}`);
  return value;
}

function printStatus(body: any): void {
  for (const repo of body.repos) {
    const error = repo.lastError ? `  error=${repo.lastError}` : "";
    process.stdout.write(
      `${repo.repo}  events=${repo.events.length}  last_poll=${repo.lastPollAt ?? "-"}  last_event=${repo.lastEventAt ?? "-"}${error}\n`,
    );
  }
  process.stdout.write(
    `quota ${body.quota.remaining}/${body.quota.limit} remaining, resets ${body.quota.resetAt ?? "-"}\n`,
  );
  process.stdout.write(
    `deliveries ${body.deliveries}, waiters ${body.waiters}, pid ${body.pid}\n`,
  );
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(`pollhook: ${errorMessage(error)}\n`);
    process.exitCode = 2;
  },
);
