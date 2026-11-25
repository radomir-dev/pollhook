import { connect, type Socket } from "node:net";
import type { Config } from "../config.ts";
import { socketPathFor } from "../daemon.ts";
import { nowIso, sleep } from "../util.ts";

export interface RpcResponse {
  ok: boolean;
  body?: any;
  error?: string;
  exitCode?: number;
}

export async function rpc(config: Config, message: Record<string, unknown>): Promise<RpcResponse> {
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

const BACKOFF_START_MS = 500;
const BACKOFF_MAX_MS = 5000;
const SEEN_LIMIT = 5000;

interface StreamState {
  since: string | undefined;
  seen: Set<string>;
}

export async function stream(
  config: Config,
  message: Record<string, unknown>,
  format: (body: any) => string = (body) => JSON.stringify(body),
): Promise<void> {
  const path = socketPathFor(config);
  const state: StreamState = { since: undefined, seen: new Set() };
  let socket = await connectSocket(path);
  for (;;) {
    await pump(socket, message, state, format);
    process.stderr.write("pollhook: connection lost, reconnecting\n");
    socket = await reconnect(path);
    process.stderr.write(`pollhook: reconnected, replaying from ${state.since}\n`);
  }
}

async function reconnect(path: string): Promise<Socket> {
  for (let delay = BACKOFF_START_MS; ; delay = Math.min(delay * 2, BACKOFF_MAX_MS)) {
    await sleep(delay);
    try {
      return await connectSocket(path);
    } catch {}
  }
}

async function pump(
  socket: Socket,
  message: Record<string, unknown>,
  state: StreamState,
  format: (body: any) => string,
): Promise<void> {
  socket.setEncoding("utf8");
  let buffer = "";
  socket.on("error", () => {});
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line) handleLine(line, state, format);
    }
  });
  socket.write(`${JSON.stringify(state.since ? { ...message, since: state.since } : message)}\n`);
  await new Promise<void>((resolve) => socket.on("close", () => resolve()));
}

function handleLine(line: string, state: StreamState, format: (body: any) => string): void {
  const body = (JSON.parse(line) as RpcResponse).body;
  if (body?.subscribed) {
    state.since ??= nowIso();
    return;
  }
  if (typeof body?.id === "string") {
    if (state.seen.has(body.id)) return;
    state.seen.add(body.id);
    if (state.seen.size > SEEN_LIMIT) state.seen.delete(state.seen.values().next().value!);
    if (typeof body.createdAt === "string") state.since = body.createdAt;
  }
  process.stdout.write(`${format(body)}\n`);
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
