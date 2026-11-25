import type { Config, RepoConfig } from "./config.ts";
import type { StateStore } from "./db.ts";
import type { Adapter, Emit, GithubClient } from "./types.ts";
import { adaptersFor } from "./registry.ts";
import { errorMessage, nowIso, unique } from "./util.ts";

export interface RepoStatus {
  repo: string;
  events: string[];
  lastPollAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
}

const TICK_MS = 1000;
const HEAD_TTL_MS = 30_000;

export class Poller {
  private readonly nextDue = new Map<string, number>();
  private readonly statuses = new Map<string, RepoStatus>();
  private readonly headCache = new Map<string, { at: number; sha: string }>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
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
      this.statuses.set(repo.repo, {
        repo: repo.repo,
        events: [...repo.events],
        lastPollAt: null,
        lastEventAt: null,
        lastError: null,
      });
    }
  }

  start(): void {
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  markEvent(repo: string): void {
    const status = this.statuses.get(repo);
    if (status) status.lastEventAt = nowIso();
  }

  listStatuses(): RepoStatus[] {
    return [...this.statuses.values()];
  }

  async pollOnce(): Promise<void> {
    if (this.stopped) return;
    for (const repo of this.config.repos) {
      const roundError = await this.pollRepo(repo);
      const status = this.statuses.get(repo.repo);
      if (!status) continue;
      if (roundError) {
        status.lastError = roundError;
      } else {
        status.lastPollAt = nowIso();
        status.lastError = null;
      }
    }
  }

  private async pollRepo(repo: RepoConfig): Promise<string | null> {
    let roundError: string | null = null;
    let refs: string[] = [];
    try {
      refs = await this.refsFor(repo);
    } catch (error) {
      roundError = errorMessage(error);
    }
    for (const adapter of adaptersFor(repo.events)) {
      try {
        await this.pollAdapter(repo, refs, adapter);
      } catch (error) {
        roundError = roundError ?? errorMessage(error);
      }
    }
    return roundError;
  }

  private async pollAdapter(repo: RepoConfig, refs: string[], adapter: Adapter): Promise<void> {
    const dueKey = `${repo.repo}:${adapter.name}`;
    if ((this.nextDue.get(dueKey) ?? 0) > Date.now()) return;
    this.nextDue.set(dueKey, Date.now() + Math.max(adapter.intervalFloorMs, repo.intervalMs));
    const primedKey = `primed:${repo.repo}:${adapter.name}`;
    const cold = this.db.getCursor(primedKey) === null;
    await adapter.poll({
      repo: repo.repo,
      refs,
      db: this.db,
      gh: this.gh,
      emit: cold
        ? () => {}
        : (event, action, key, payload, state) =>
            this.emit(repo.repo, event, action, key, payload, state),
    });
    if (cold) this.db.setCursor(primedKey, null, "1");
  }

  private loop(): void {
    void this.pollOnce().finally(() => {
      if (!this.stopped) this.schedule(TICK_MS);
    });
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => this.loop(), delay);
  }

  private async refsFor(repo: RepoConfig): Promise<string[]> {
    const wantsRefs = repo.events.some(
      (event) => event === "check_run" || event === "check_suite" || event === "status",
    );
    if (!wantsRefs) return [];
    const refs = this.db
      .listSnapshots(repo.repo, "pull_request")
      .filter((row) => row.data?.state === "open" && typeof row.data?.head?.sha === "string")
      .slice(0, repo.checkRefLimit)
      .map((row) => row.data.head.sha as string);
    const head = await this.defaultBranchHead(repo.repo);
    if (head) refs.push(head);
    return unique(refs);
  }

  private async defaultBranchHead(repo: string): Promise<string | null> {
    const cached = this.headCache.get(repo);
    if (cached && cached.at + HEAD_TTL_MS > Date.now()) return cached.sha;
    try {
      const info = await this.gh.repoInfo(repo);
      const result = await this.gh.get<{ object: { sha: string } }>(
        `/repos/${repo}/git/ref/heads/${encodeURIComponent(info.default_branch)}`,
      );
      const sha = result.data?.object?.sha;
      if (!sha) return null;
      this.headCache.set(repo, { at: Date.now(), sha });
      return sha;
    } catch {
      return null;
    }
  }
}
