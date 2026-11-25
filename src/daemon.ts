import { rmSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { configPath, loadConfig, type Config } from "./config.ts";
import { handleConnection } from "./daemon/handlers.ts";
import { createRuntime, type DaemonOptions, type Runtime } from "./daemon/runtime.ts";
import { watchConfig } from "./daemon/watch.ts";

export type { DaemonOptions };

export interface DaemonHandle {
  socketPath: string;
  closed: Promise<void>;
  close(): Promise<void>;
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
  const path = configPath(options.configPath);
  const reload = () => {
    try {
      runtime.reload(loadConfig(path));
    } catch (error) {
      runtime.configError(error);
    }
  };
  const watch = options.watch === false ? null : watchConfig(path, reload, runtime.configError);
  process.on("SIGHUP", reload);
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());

  const stop = createClose(server, runtime, sockets, socketPath, resolveClosed);
  const close = async () => {
    watch?.stop();
    process.off("SIGHUP", reload);
    await stop();
  };
  return { socketPath, closed, close };
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
    runtime.stop();
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
