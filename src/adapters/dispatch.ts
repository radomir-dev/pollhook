import type { Adapter, AdapterContext, RepoInfo } from "../types.ts";
import { repoAndSender } from "./common.ts";

interface RunsResponse {
  workflow_runs: any[];
}

interface Meta {
  repository: RepoInfo;
  sender: Record<string, unknown>;
}

async function fetchRuns(
  ctx: AdapterContext,
  event: "workflow_dispatch" | "merge_group",
): Promise<{ runs: any[]; meta: Meta } | null> {
  const result = await ctx.gh.get<RunsResponse>(
    `/repos/${ctx.repo}/actions/runs?event=${event}&per_page=30`,
    { etagKey: `runs:${event}:${ctx.repo}` },
  );
  if (result.notModified || !result.data) return null;
  const runs = result.data.workflow_runs.filter((run) => run.event === event);
  if (runs.length === 0) return null;
  return { runs, meta: await repoAndSender(ctx) };
}

export const workflowDispatch: Adapter = {
  name: "workflow_dispatch",
  intervalFloorMs: 60_000,
  async poll(ctx) {
    const batch = await fetchRuns(ctx, "workflow_dispatch");
    if (!batch) return;
    for (const run of batch.runs) {
      const key = String(run.id);
      if (ctx.db.getSnapshot(ctx.repo, "workflow_dispatch", key)) continue;
      ctx.db.putSnapshot(ctx.repo, "workflow_dispatch", key, String(run.run_attempt), run);
      ctx.emit(
        "workflow_dispatch",
        null,
        key,
        { workflow_run: run, repository: batch.meta.repository, sender: batch.meta.sender },
        String(run.run_attempt),
      );
    }
  },
};

export const mergeGroup: Adapter = {
  name: "merge_group",
  intervalFloorMs: 60_000,
  async poll(ctx) {
    const batch = await fetchRuns(ctx, "merge_group");
    if (!batch) return;
    for (const run of batch.runs) {
      const key = String(run.id);
      if (ctx.db.getSnapshot(ctx.repo, "merge_group", key)) continue;
      ctx.db.putSnapshot(ctx.repo, "merge_group", key, String(run.head_sha), run);
      ctx.emit(
        "merge_group",
        "checks_requested",
        key,
        {
          action: "checks_requested",
          merge_group: {
            head_sha: run.head_sha,
            head_ref: run.head_branch,
            base_sha: null,
            base_ref: null,
          },
          workflow_run: run,
          repository: batch.meta.repository,
          sender: batch.meta.sender,
        },
        String(run.head_sha),
      );
    }
  },
};
