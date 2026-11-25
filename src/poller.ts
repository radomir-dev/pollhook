import type { Config } from "./config.ts";
import type { StateStore } from "./db.ts";
import type { Adapter, AdapterScope, Emit, EventName, GithubClient } from "./types.ts";
import { adaptersFor } from "./registry.ts";
import { HeadCache, refsFor } from "./poller/refs.ts";
import { delayFor } from "./poller/schedule.ts";
import { DEGRADED_MS, isPermanent, statusFor, type RepoStatus } from "./poller/status.ts";
import { errorMessage, nowIso } from "./util.ts";

const TICK_MS = 1000;

export class Poller {
  private readonly nextDue = new Map<string, number>();
  private readonly statuses = new Map<string, RepoStatus>();
  private readonly headCache = new HeadCache();
  private readonly degraded = new Map<string, Map<EventName, string>>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private running = false;
  private readonly config: Config;
  private readonly db: StateStore;
  private readonly gh: GithubClient;
  private readonly emit: Emit;

  constructor(config: Config, db: StateStore, gh: GithubClient, emit: Emit) {
    this.config = config;
    this.db = db;
    this.gh = gh;
    this.emit = emit;
    for (const repo of config.repos) {
      this.statuses.set(repo.repo, statusFor("repo", repo.repo, repo.events));
    }
    for (const org of config.orgs) {
      this.statuses.set(org.org, statusFor("org", org.org, org.events));
    }
  }

  start(): void {
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  markEvent(target: string): void {
    const status = this.statuses.get(target);
    if (status) status.lastEventAt = nowIso();
  }

  listStatuses(): RepoStatus[] {
    return [...this.statuses.values()].map((status) => ({
      ...status,
      nextPollAt: this.nextPollFor(status),
      degraded: this.degradedFor(status.repo),
    }));
  }

  private nextPollFor(status: RepoStatus): string | null {
    const due = adaptersFor(status.events as EventName[], status.kind)
      .map((adapter) => this.nextDue.get(`${status.kind}:${status.repo}:${adapter.name}`))
      .filter((value): value is number => typeof value === "number");
    if (due.length === 0) return null;
    return new Date(Math.min(...due)).toISOString();
  }

  async pollOnce(): Promise<void> {
    if (this.stopped) return;
    for (const repo of this.config.repos) {
      await this.pollTarget("repo", repo.repo, repo.events, repo.intervalMs, repo.checkRefLimit);
    }
    for (const org of this.config.orgs) {
      await this.pollTarget("org", org.org, org.events, org.intervalMs, 0);
    }
  }

  private async pollTarget(
    kind: AdapterScope,
    name: string,
    events: EventName[],
    intervalMs: number,
    checkRefLimit: number,
  ): Promise<void> {
    const roundError = await this.pollAdapters(kind, name, events, intervalMs, checkRefLimit);
    const status = this.statuses.get(name);
    if (!status) return;
    if (roundError) {
      status.lastError = roundError;
    } else {
      status.lastPollAt = nowIso();
      status.lastError = null;
    }
  }

  private async pollAdapters(
    kind: AdapterScope,
    name: string,
    events: EventName[],
    intervalMs: number,
    checkRefLimit: number,
  ): Promise<string | null> {
    let roundError: string | null = null;
    let refs: string[] = [];
    if (kind === "repo") {
      try {
        refs = await refsFor(this.db, this.headCache, this.gh, name, events, checkRefLimit);
      } catch (error) {
        roundError = errorMessage(error);
      }
    }
    for (const adapter of adaptersFor(events, kind)) {
      try {
        const polled = await this.pollAdapter(kind, name, refs, intervalMs, adapter);
        if (polled) this.clearDegraded(name, adapter.name);
      } catch (error) {
        if (isPermanent(error)) {
          this.markDegraded(name, adapter.name, error);
          this.nextDue.set(`${kind}:${name}:${adapter.name}`, Date.now() + DEGRADED_MS);
        } else {
          roundError = roundError ?? errorMessage(error);
        }
      }
    }
    return roundError;
  }

  private markDegraded(name: string, event: EventName, error: unknown): void {
    const events = this.degraded.get(name) ?? new Map<EventName, string>();
    if (!events.has(event)) events.set(event, errorMessage(error));
    this.degraded.set(name, events);
  }

  private clearDegraded(name: string, event: EventName): void {
    this.degraded.get(name)?.delete(event);
  }

  private degradedFor(name: string): Array<{ event: string; reason: string }> {
    return [...(this.degraded.get(name) ?? new Map<EventName, string>())].map(
      ([event, reason]) => ({ event, reason }),
    );
  }

  private async pollAdapter(
    kind: AdapterScope,
    name: string,
    refs: string[],
    intervalMs: number,
    adapter: Adapter,
  ): Promise<boolean> {
    const dueKey = `${kind}:${name}:${adapter.name}`;
    if ((this.nextDue.get(dueKey) ?? 0) > Date.now()) return false;
    this.nextDue.set(dueKey, Date.now() + delayFor(adapter, intervalMs, this.db, name));
    const primedKey = `primed:${kind}:${name}:${adapter.name}`;
    const cold = this.db.getCursor(primedKey) === null;
    await adapter.poll({
      repo: name,
      org: kind === "org" ? name : null,
      refs,
      db: this.db,
      durations: this.db.durations,
      gh: this.gh,
      emit: cold
        ? () => {}
        : (event, action, key, payload, state) =>
            this.emit(name, event, action, key, payload, state),
    });
    if (cold) this.db.setCursor(primedKey, null, "1");
    return true;
  }

  poke(target?: string): boolean {
    if (target && !this.statuses.has(target)) return false;
    for (const key of this.nextDue.keys()) {
      const [, name, adapter] = key.split(":") as [string, string, EventName];
      if (target && name !== target) continue;
      if (this.degraded.get(name)?.has(adapter)) continue;
      this.nextDue.delete(key);
    }
    if (!this.running && !this.stopped) {
      if (this.timer) clearTimeout(this.timer);
      this.schedule(0);
    }
    return true;
  }

  private loop(): void {
    this.running = true;
    void this.pollOnce().finally(() => {
      this.running = false;
      if (!this.stopped) this.schedule(TICK_MS);
    });
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => this.loop(), delay);
  }
}
