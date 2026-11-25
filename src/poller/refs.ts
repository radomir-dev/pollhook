import type { EventName, GithubClient, SnapshotStore } from "../types.ts";
import { unique } from "../util.ts";

const HEAD_TTL_MS = 30_000;

export class HeadCache {
  private readonly entries = new Map<string, { at: number; sha: string }>();

  async head(gh: GithubClient, repo: string): Promise<string | null> {
    const cached = this.entries.get(repo);
    if (cached && cached.at + HEAD_TTL_MS > Date.now()) return cached.sha;
    try {
      const info = await gh.repoInfo(repo);
      const result = await gh.get<{ object: { sha: string } }>(
        `/repos/${repo}/git/ref/heads/${encodeURIComponent(info.default_branch)}`,
      );
      const sha = result.data?.object?.sha;
      if (!sha) return null;
      this.entries.set(repo, { at: Date.now(), sha });
      return sha;
    } catch {
      return null;
    }
  }
}

export async function refsFor(
  db: SnapshotStore,
  cache: HeadCache,
  gh: GithubClient,
  repo: string,
  events: EventName[],
  limit: number,
): Promise<string[]> {
  const wantsRefs = events.some(
    (event) => event === "check_run" || event === "check_suite" || event === "status",
  );
  if (!wantsRefs) return [];
  const refs = db
    .listSnapshots(repo, "pull_request")
    .filter((row) => row.data?.state === "open" && typeof row.data?.head?.sha === "string")
    .slice(0, limit)
    .map((row) => row.data.head.sha as string);
  const head = await cache.head(gh, repo);
  if (head) refs.push(head);
  return unique(refs);
}
