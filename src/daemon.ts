import { rmSync } from "node:fs";
import { connect, createServer, type Socket } from "node:net";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { StateStore } from "./db.ts";
import { postDelivery } from "./delivery.ts";
import { GitHub, resolveToken } from "./github.ts";
import { Poller } from "./poller.ts";
import { ADAPTERS, IMPLEMENTED_EVENTS } from "./registry.ts";
import type { Delivery, Emit, GithubClient } from "./types.ts";
import { errorMessage } from "./util.ts";
import { resolveWait, type WaitOutcome, type WaitRequest } from "./waits.ts";

const PRUNE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_WAIT_MS = 30 * 60 * 1000;

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

export async function startDaemon(config: Config, options: DaemonOptions = {}): Promise<DaemonHandle> {
  const socketPath = options.socketPath ?? socketPathFor(config);
  if (await socketAlive(socketPath)) {
    throw new Error(`another pollhook is listening on ${socketPath}`);
  }

  const db = new StateStore(join(config.stateDir, "state.db"));
  db.prune(PRUNE_MS);
  const gh = options.gh ?? new GitHub(resolveToken(), db);
  const listeners = new Set<(delivery: Delivery) => void>();
  let waiterCount = 0;
  let poller: Poller | null = null;

  const emit: Emit = (repo, event, action, key, payload, state) => {
    const delivery = db.recordDelivery(repo, event, action, key, state, payload);
    if (!delivery) return;
    poller?.markEvent(repo);
    for (const listener of listeners) {
      try {
        listener(delivery);
      } catch {}
    }
    if (config.deliver) {
      void postDelivery(delivery, config.deliver)
        .then(() => db.markDelivered(delivery.id))
        .catch((error) =>
          console.error(`[pollhook] delivery ${delivery.id} failed: ${errorMessage(error)}`),
        );
    }
  };

  poller = new Poller(config, db, gh, emit);
  poller.start();

  const statusBody = () => ({
    pid: process.pid,
    socket: socketPath,
    quota: gh instanceof GitHub ? gh.quota : null,
    repos: poller?.listStatuses() ?? [],
    waiters: waiterCount,
    deliveries: db.countDeliveries(),
  });

  const startWait = (socket: Socket, message: any, cleanup: Array<() => void>): void => {
    const request = message.request as WaitRequest;
    if (!request || typeof request.kind !== "string") {
      writeLine(socket, { ok: false, error: "wait request missing" });
      return;
    }
    if (request.kind === "checks" && !request.initialHead) {
      request.initialHead = db.getSnapshot(request.repo, "pull_request", String(request.pr))?.data
        ?.head?.sha;
    }
    let settled = false;
    let interval: NodeJS.Timeout | undefined;
    let timer: NodeJS.Timeout | undefined;
    waiterCount += 1;

    const wake = () => check();
    const finish = (outcome: WaitOutcome) => {
      if (settled) return;
      settled = true;
      if (interval) clearInterval(interval);
      if (timer) clearTimeout(timer);
      listeners.delete(wake);
      waiterCount -= 1;
      writeLine(socket, { ok: true, ...outcome });
    };
    const check = () => {
      const outcome = resolveWait(db, request);
      if (outcome) finish(outcome);
    };

    listeners.add(wake);
    interval = setInterval(check, 250);
    timer = setTimeout(
      () => finish({ exitCode: 8, body: { reason: "timeout" } }),
      Number(message.timeoutMs ?? DEFAULT_WAIT_MS),
    );
    cleanup.push(() => {
      if (settled) return;
      settled = true;
      if (interval) clearInterval(interval);
      if (timer) clearTimeout(timer);
      listeners.delete(wake);
      waiterCount -= 1;
    });
    check();
  };

  const handle = (socket: Socket, message: any, cleanup: Array<() => void>): void => {
    switch (message.op) {
      case "status":
        writeLine(socket, { ok: true, body: statusBody() });
        return;
      case "events":
        writeLine(socket, {
          ok: true,
          body: IMPLEMENTED_EVENTS.map((event) => ({
            event,
            intervalFloorSeconds: ADAPTERS[event].intervalFloorMs / 1000,
          })),
        });
        return;
      case "deliveries":
        writeLine(socket, {
          ok: true,
          body: db.listDeliveries(Number(message.limit ?? 20), message.repo),
        });
        return;
      case "emit": {
        const listener = (delivery: Delivery) => writeLine(socket, { ok: true, body: delivery });
        listeners.add(listener);
        cleanup.push(() => listeners.delete(listener));
        writeLine(socket, { ok: true, body: { subscribed: true, pid: process.pid } });
        return;
      }
      case "wait":
        startWait(socket, message, cleanup);
        return;
      default:
        writeLine(socket, { ok: false, error: `unknown op ${String(message.op)}` });
    }
  };

  const server = createServer((socket) => {
    let buffer = "";
    const cleanup: Array<() => void> = [];
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) {
          try {
            handle(socket, JSON.parse(line), cleanup);
          } catch {
            writeLine(socket, { ok: false, error: "invalid json" });
          }
        }
        index = buffer.indexOf("\n");
      }
    });
    socket.on("close", () => {
      for (const fn of cleanup) fn();
    });
    socket.on("error", () => {});
  });

  rmSync(socketPath, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });

  let closedResolve: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    closedResolve = resolve;
  });
  let closing = false;

  const close = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    poller?.stop();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    db.close();
    rmSync(socketPath, { force: true });
    closedResolve();
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());

  return { socketPath, closed, close };
}

function writeLine(socket: Socket, message: unknown): void {
  if (socket.destroyed) return;
  socket.write(`${JSON.stringify(message)}\n`);
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
