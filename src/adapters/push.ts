import type { Adapter, AdapterContext, RepoInfo } from "../types.ts";
import { isStatus } from "../util.ts";
import { repoAndSender } from "./common.ts";

interface Branch {
  name: string;
  commit: { sha: string };
}

interface Compare {
  status: string;
  html_url: string;
  commits: any[];
}

interface Meta {
  repository: RepoInfo;
  sender: Record<string, unknown>;
}

const ZERO = "0".repeat(40);

export const push: Adapter = {
  name: "push",
  intervalFloorMs: 30_000,
  async poll(ctx) {
    const result = await ctx.gh.get<Branch[]>(`/repos/${ctx.repo}/branches?per_page=100`, {
      etagKey: `branches:${ctx.repo}`,
    });
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    for (const branch of result.data) {
      const after = branch.commit?.sha;
      if (!after) continue;
      const previous = ctx.db.getSnapshot(ctx.repo, "push", branch.name);
      const before = previous?.data?.sha as string | undefined;
      if (before === after) continue;

      let payload: Record<string, unknown> | null = null;
      try {
        payload = before
          ? await comparePayload(ctx, branch.name, before, after, meta)
          : await createdPayload(ctx, branch.name, after, meta);
      } catch (error) {
        if (!isStatus(error, 404)) throw error;
      }
      ctx.db.putSnapshot(ctx.repo, "push", branch.name, after, { name: branch.name, sha: after });
      if (!payload) continue;
      ctx.emit("push", null, branch.name, payload, `${before ?? "created"}:${after}`);
    }
  },
};

async function comparePayload(
  ctx: AdapterContext,
  branch: string,
  before: string,
  after: string,
  meta: Meta,
): Promise<Record<string, unknown>> {
  const result = await ctx.gh.get<Compare>(`/repos/${ctx.repo}/compare/${before}...${after}`);
  const compare = result.data;
  if (!compare) throw new Error("empty compare response");
  return {
    ref: `refs/heads/${branch}`,
    before,
    after,
    created: false,
    deleted: false,
    forced: compare.status === "diverged",
    base_ref: null,
    compare: compare.html_url,
    commits: compare.commits ?? [],
    head_commit: compare.commits?.at(-1) ?? null,
    repository: meta.repository,
    pusher: meta.sender,
    sender: meta.sender,
  };
}

async function createdPayload(
  ctx: AdapterContext,
  branch: string,
  after: string,
  meta: Meta,
): Promise<Record<string, unknown>> {
  const result = await ctx.gh.get<any[]>(
    `/repos/${ctx.repo}/commits?sha=${encodeURIComponent(branch)}&per_page=20`,
  );
  const commits = result.data ?? [];
  return {
    ref: `refs/heads/${branch}`,
    before: ZERO,
    after,
    created: true,
    deleted: false,
    forced: false,
    base_ref: null,
    compare: `https://github.com/${ctx.repo}/compare/${ZERO}...${after}`,
    commits,
    head_commit: commits[0] ?? null,
    repository: meta.repository,
    pusher: meta.sender,
    sender: meta.sender,
  };
}
