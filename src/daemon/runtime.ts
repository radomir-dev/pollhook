import { join } from "node:path";
import type { Config } from "../config.ts";
import { StateStore } from "../db.ts";
import { postDelivery } from "../delivery.ts";
import { GitHub, resolveToken } from "../github.ts";
import { Poller } from "../poller.ts";
import type { Delivery, Emit, GithubClient } from "../types.ts";
import { errorMessage, nowIso } from "../util.ts";
import type { DaemonContext } from "./context.ts";

const PRUNE_MS = 7 * 24 * 60 * 60 * 1000;

export interface DaemonOptions {
  gh?: GithubClient;
  socketPath?: string;
  configPath?: string;
  watch?: boolean;
  idleExitMs?: number;
}

export interface Runtime {
  db: StateStore;
  config(): Config;
  reload(next: Config): void;
  stop(): void;
  configError(error: unknown): void;
  context: DaemonContext;
}

export function createRuntime(
  initial: Config,
  options: DaemonOptions,
  socketPath: string,
): Runtime {
  const db = new StateStore(join(initial.stateDir, "state.db"));
  db.prune(PRUNE_MS);
  const gh = options.gh ?? new GitHub(resolveToken(), db, process.env.POLLHOOK_API_URL);
  const listeners = new Set<(delivery: Delivery) => void>();
  const waiters = { count: 0 };
  const ref: { poller?: Poller; config: Config; reloadedAt: string | null; error: string | null } =
    { config: initial, reloadedAt: null, error: null };
  const emit = createEmit(() => ref.config, db, listeners, ref);
  ref.poller = new Poller(initial, db, gh, emit);
  ref.poller.start();

  const status = () => ({
    pid: process.pid,
    socket: socketPath,
    quota: gh instanceof GitHub ? gh.quota : null,
    http: gh instanceof GitHub ? gh.stats : null,
    repos: ref.poller?.listStatuses() ?? [],
    waiters: waiters.count,
    deliveries: db.countDeliveries(),
    configReloadedAt: ref.reloadedAt,
    configError: ref.error,
  });
  const poke = (repo?: string) => ref.poller?.poke(repo) ?? false;
  const config = () => ref.config;
  const stop = () => ref.poller?.stop();
  const reload = (next: Config) => {
    ref.poller?.stop();
    ref.config = next;
    ref.poller = new Poller(next, db, gh, emit);
    ref.poller.start();
    ref.reloadedAt = nowIso();
    ref.error = null;
  };
  const configError = (error: unknown) => {
    ref.error = errorMessage(error);
  };
  return {
    db,
    config,
    reload,
    configError,
    stop,
    context: { db, listeners, status, poke, waiters, stop: () => {} },
  };
}

function createEmit(
  currentConfig: () => Config,
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
    const deliver = currentConfig().deliver;
    if (!deliver) return;
    void postDelivery(delivery, deliver)
      .then(() => db.markDelivered(delivery.id))
      .catch((error) =>
        console.error(`[pollhook] delivery ${delivery.id} failed: ${errorMessage(error)}`),
      );
  };
}
