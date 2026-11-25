import { execFileSync } from "node:child_process";
import type { StateStore } from "./db.ts";
import type { GetResult, GithubClient, RepoInfo } from "./types.ts";
import { sleep } from "./util.ts";

const DEFAULT_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";
const MIN_REMAINING = 100;

export interface Quota {
  limit: number;
  remaining: number;
  resetAt: string | null;
}

export class GitHubError extends Error {
  readonly status: number;

  constructor(status: number, path: string, body: string) {
    super(`${status} ${path}: ${body.slice(0, 200)}`);
    this.status = status;
  }
}

export function resolveToken(): string {
  const fromEnv = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
    if (token) return token;
  } catch {}
  throw new Error("no GitHub token: set GH_TOKEN, GITHUB_TOKEN, or run `gh auth login`");
}

export class GitHub implements GithubClient {
  private readonly etags = new Map<string, string>();
  private readonly memoValues = new Map<string, { at: number; value: unknown }>();
  private readonly token: string;
  private readonly db: StateStore;
  private readonly baseUrl: string;
  quota: Quota = { limit: 0, remaining: 5000, resetAt: null };

  constructor(token: string, db: StateStore, baseUrl = DEFAULT_BASE) {
    this.token = token;
    this.db = db;
    this.baseUrl = baseUrl;
  }

  async get<T>(path: string, opts: { etagKey?: string } = {}): Promise<GetResult<T>> {
    const etagKey = opts.etagKey;
    const etag = etagKey ? (this.etags.get(etagKey) ?? this.db.getCursor(etagKey)?.etag ?? undefined) : undefined;
    for (let attempt = 0; ; attempt++) {
      await this.gate();
      const headers: Record<string, string> = {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "user-agent": "pollhook/0.1.0",
        "x-github-api-version": API_VERSION,
      };
      if (etag) headers["if-none-match"] = etag;
      const response = await fetch(this.baseUrl + path, {
        headers,
        signal: AbortSignal.timeout(20_000),
      });
      this.readQuota(response);
      if (response.status === 304) return { notModified: true, data: undefined };
      if ((response.status === 403 || response.status === 429) && this.quota.remaining < MIN_REMAINING && attempt < 1) {
        await this.waitForReset();
        continue;
      }
      if (response.status >= 500 && attempt < 2) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (!response.ok) throw new GitHubError(response.status, path, await response.text());
      const nextEtag = response.headers.get("etag");
      if (nextEtag && etagKey) {
        this.etags.set(etagKey, nextEtag);
        this.db.setCursor(etagKey, nextEtag, null);
      }
      return { notModified: false, data: (await response.json()) as T };
    }
  }

  async repoInfo(repo: string): Promise<RepoInfo> {
    return this.memoized(`/repos/${repo}`, 10 * 60_000, async () => {
      const result = await this.get<RepoInfo>(`/repos/${repo}`);
      if (!result.data) throw new Error(`empty repository response for ${repo}`);
      return result.data;
    });
  }

  async sender(): Promise<Record<string, unknown>> {
    return this.memoized("/user", 60 * 60_000, async () => {
      const result = await this.get<Record<string, unknown>>("/user");
      return result.data ?? { login: "ghost" };
    });
  }

  private async memoized<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.memoValues.get(key);
    if (hit && hit.at + ttlMs > Date.now()) return hit.value as T;
    const value = await load();
    this.memoValues.set(key, { at: Date.now(), value });
    return value;
  }

  private readQuota(response: Response): void {
    const limit = Number(response.headers.get("x-ratelimit-limit") ?? 0);
    const remaining = Number(response.headers.get("x-ratelimit-remaining") ?? this.quota.remaining);
    const reset = response.headers.get("x-ratelimit-reset");
    this.quota = {
      limit: limit || this.quota.limit,
      remaining,
      resetAt: reset ? new Date(Number(reset) * 1000).toISOString() : this.quota.resetAt,
    };
  }

  private async gate(): Promise<void> {
    if (this.quota.remaining >= MIN_REMAINING || !this.quota.resetAt) return;
    await this.waitForReset();
  }

  private async waitForReset(): Promise<void> {
    if (!this.quota.resetAt) return;
    const waitMs = Math.min(Date.parse(this.quota.resetAt) - Date.now(), 15 * 60_000);
    if (waitMs > 0) await sleep(waitMs + 1000);
  }
}
