import type { Adapter } from "../types.ts";
import { observe, repoAndSender } from "./common.ts";

interface CheckRunsResponse {
  total_count: number;
  check_runs: any[];
}

export const checkRun: Adapter = {
  name: "check_run",
  intervalFloorMs: 30_000,
  async poll(ctx) {
    if (ctx.refs.length === 0) return;
    const meta = await repoAndSender(ctx);
    for (const ref of ctx.refs) {
      const result = await ctx.gh.get<CheckRunsResponse>(
        `/repos/${ctx.repo}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100`,
        { etagKey: `check-runs:${ctx.repo}:${ref}` },
      );
      if (result.notModified || !result.data) continue;
      for (const run of result.data.check_runs) {
        const state = `${run.status}:${run.conclusion}:${run.completed_at}`;
        const { changed } = observe(ctx, "check_run", String(run.id), state, run);
        if (!changed) continue;
        const action = run.status === "completed" ? "completed" : "created";
        ctx.emit(
          "check_run",
          action,
          String(run.id),
          { action, check_run: run, repository: meta.repository, sender: meta.sender },
          state,
        );
      }
    }
  },
};
