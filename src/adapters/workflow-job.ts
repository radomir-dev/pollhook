import type { Adapter } from "../types.ts";
import { observe, repoAndSender } from "./common.ts";

const MAX_ACTIVE_RUNS = 5;

interface JobsResponse {
  total_count: number;
  jobs: any[];
}

export const workflowJob: Adapter = {
  name: "workflow_job",
  intervalFloorMs: 30_000,
  async poll(ctx) {
    const active = ctx.db
      .listSnapshots(ctx.repo, "workflow_run")
      .filter((row) => row.data?.status !== "completed")
      .slice(0, MAX_ACTIVE_RUNS);
    if (active.length === 0) return;
    const meta = await repoAndSender(ctx);
    for (const row of active) {
      const runId = String(row.data?.id ?? row.key);
      const result = await ctx.gh.get<JobsResponse>(
        `/repos/${ctx.repo}/actions/runs/${runId}/jobs?per_page=100`,
        { etagKey: `jobs:${ctx.repo}:${runId}` },
      );
      if (result.notModified || !result.data) continue;
      for (const job of result.data.jobs) {
        const state = `${job.run_attempt}:${job.status}:${job.conclusion}:${job.completed_at}`;
        const { changed } = observe(ctx, "workflow_job", String(job.id), state, job);
        if (!changed) continue;
        const action =
          job.status === "completed"
            ? "completed"
            : job.status === "in_progress"
              ? "in_progress"
              : "queued";
        ctx.emit(
          "workflow_job",
          action,
          String(job.id),
          { action, workflow_job: job, repository: meta.repository, sender: meta.sender },
          state,
        );
      }
    }
  },
};
