import { rmSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { StateStore } from "./db.ts";
import { postDelivery } from "./delivery.ts";
import { GitHub, resolveToken } from "./github.ts";
import { Poller } from "./poller.ts";
import type { Delivery, Emit, GithubClient } from "./types.ts";
import { errorMessage } from "./util.ts";
import type { DaemonContext } from "./daemon/context.ts";
import { handleConnection } from "./daemon/handlers.ts";

const PRUNE_MS = 7 * 24 * 60 * 60 * 1000;

export interface DaemonHandle {
  socketPath: string;
  closed: Promise<void>;
  close(): Promise<void>;
}

export interface DaemonOptions {
  gh?: GithubClient;
  socketPath?: string;
}

export function socketPathFor(config: Config): string {
  return join(process.env.XDG_RUNTIME_DIR ?? config.stateDir, "pollhook.sock");
}

export async function startDaemon(
  config: Config,
  options: DaemonOptions = {},
): Promise<DaemonHandle> {
  const socketPath = options.socketPath ?? socketPathFor(config);
  if (await socketAlive(socketPath)) {
    throw new Error(`another pollhook is listening on ${socketPath}`);
  }

  const runtime = createRuntime(config, options, socketPath);
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    handleConnection(socket, runtime.context);
  });
  await listen(server, socketPath);

  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const close = createClose(server, runtime, sockets, socketPath, resolveClosed);
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  return { socketPath, closed, close };
}

interface Runtime {
  db: StateStore;
  poller: Poller;
  context: DaemonContext;
}

function createRuntime(config: Config, options: DaemonOptions, socketPath: string): Runtime {
  const db = new StateStore(join(config.stateDir, "state.db"));
  db.prune(PRUNE_MS);
  const gh = options.gh ?? new GitHub(resolveToken(), db);
  const listeners = new Set<(delivery: Delivery) => void>();
  const waiters = { count: 0 };
  const ref: { poller?: Poller } = {};
  const emit = createEmit(config, db, listeners, ref);
  const poller = new Poller(config, db, gh, emit);
  ref.poller = poller;
  poller.start();

  const status = () => ({
    pid: process.pid,
    socket: socketPath,
    quota: gh instanceof GitHub ? gh.quota : null,
    http: gh instanceof GitHub ? gh.stats : null,
    repos: poller.listStatuses(),
    waiters: waiters.count,
    deliveries: db.countDeliveries(),
  });
  return { db, poller, context: { db, listeners, status, waiters } };
}

function createEmit(
  config: Config,
  db: StateStore,
  listeners: Set<(delivery: Delivery) => void>,
  ref: { poller?: Poller },
): Emit {
  return (repo, event, action, key, payload, state) => {
    const delivery = db.recordDelivery(repo, event, action, key, state, payload);
    if (!delivery) return;
    ref.poller?.markEvent(repo);
    for (const listener of listeners) {
      try {
        listener(delivery);
      } catch {}
    }
    if (!config.deliver) return;
    void postDelivery(delivery, config.deliver)
      .then(() => db.markDelivered(delivery.id))
      .catch((error) =>
        console.error(`[pollhook] delivery ${delivery.id} failed: ${errorMessage(error)}`),
      );
  };
}

async function listen(server: Server, path: string): Promise<void> {
  rmSync(path, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function createClose(
  server: Server,
  runtime: Runtime,
  sockets: Set<Socket>,
  socketPath: string,
  resolveClosed: () => void,
): () => Promise<void> {
  let closing = false;
  return async () => {
    if (closing) return;
    closing = true;
    runtime.poller.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    runtime.db.close();
    rmSync(socketPath, { force: true });
    resolveClosed();
  };
}

function socketAlive(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}
