import type { Adapter, AdapterContext } from "../types.ts";
import { observe, repoAndSender } from "./common.ts";

interface RunsResponse {
  total_count: number;
  workflow_runs: any[];
}

export const workflowRun: Adapter = {
  name: "workflow_run",
  intervalFloorMs: 10_000,
  async poll(ctx) {
    const result = await ctx.gh.get<RunsResponse>(`/repos/${ctx.repo}/actions/runs?per_page=50`, {
      etagKey: `runs:${ctx.repo}`,
    });
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    for (const run of result.data.workflow_runs) {
      const state = `${run.run_attempt}:${run.status}:${run.conclusion}`;
      if (run.status === "completed") recordDuration(ctx, run);
      const { changed } = observe(ctx, "workflow_run", String(run.id), state, run);
      if (!changed) continue;
      const action =
        run.status === "completed"
          ? "completed"
          : run.status === "in_progress"
            ? "in_progress"
            : "requested";
      ctx.emit(
        "workflow_run",
        action,
        String(run.id),
        { action, workflow_run: run, repository: meta.repository, sender: meta.sender },
        state,
      );
    }
  },
};

function recordDuration(ctx: AdapterContext, run: any): void {
  const start = Date.parse(run.run_started_at ?? run.created_at ?? "");
  const end = Date.parse(run.updated_at ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
  ctx.durations.record(
    ctx.repo,
    String(run.id),
    String(run.workflow_id ?? run.name ?? ""),
    end - start,
  );
}
