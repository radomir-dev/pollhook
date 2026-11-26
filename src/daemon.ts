import { rmSync } from "node:fs";
import { connect, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { configPath, loadConfig, type Config } from "./config.ts";
import { handleConnection } from "./daemon/handlers.ts";
import { createIdleExit } from "./daemon/idle.ts";
import { acquireLock } from "./daemon/lock.ts";
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
  const unlock = acquireLock(config.stateDir);
  try {
    return await serve(config, options, socketPath, unlock);
  } catch (error) {
    unlock();
    throw error;
  }
}

async function serve(
  config: Config,
  options: DaemonOptions,
  socketPath: string,
  unlock: () => void,
): Promise<DaemonHandle> {
  const runtime = createRuntime(config, options, socketPath);
  const sockets = new Set<Socket>();
  const idle = createIdleExit(config.deliver ? undefined : options.idleExitMs, () => void close());
  const server = createServer((socket) => track(socket, sockets, idle, runtime));
  await listen(server, socketPath);

  const { closed, resolveClosed } = deferred();
  const reloader = reloadOnChange(runtime, options);
  const stopServer = createClose(server, runtime, sockets, socketPath, unlock, resolveClosed);
  const close = async () => {
    idle.stop();
    reloader.stop();
    await stopServer();
  };
  runtime.context.stop = () => void close();
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  idle.quiet();
  return { socketPath, closed, close };
}

function track(
  socket: Socket,
  sockets: Set<Socket>,
  idle: ReturnType<typeof createIdleExit>,
  runtime: Runtime,
): void {
  sockets.add(socket);
  idle.connected();
  socket.on("close", () => {
    sockets.delete(socket);
    if (sockets.size === 0) idle.quiet();
  });
  handleConnection(socket, runtime.context);
}

function deferred(): { closed: Promise<void>; resolveClosed: () => void } {
  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  return { closed, resolveClosed };
}

function reloadOnChange(runtime: Runtime, options: DaemonOptions): { stop(): void } {
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
  return {
    stop() {
      watch?.stop();
      process.off("SIGHUP", reload);
    },
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
  unlock: () => void,
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
    unlock();
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
