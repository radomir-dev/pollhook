import type { Adapter } from "../types.ts";
import { observe, repoAndSender } from "./common.ts";

interface CheckSuitesResponse {
  total_count: number;
  check_suites: any[];
}

export const checkSuite: Adapter = {
  name: "check_suite",
  intervalFloorMs: 30_000,
  async poll(ctx) {
    if (ctx.refs.length === 0) return;
    const meta = await repoAndSender(ctx);
    for (const ref of ctx.refs) {
      const result = await ctx.gh.get<CheckSuitesResponse>(
        `/repos/${ctx.repo}/commits/${encodeURIComponent(ref)}/check-suites?per_page=100`,
        { etagKey: `check-suites:${ctx.repo}:${ref}` },
      );
      if (result.notModified || !result.data) continue;
      for (const suite of result.data.check_suites) {
        const state = `${suite.status}:${suite.conclusion}:${suite.updated_at}`;
        const { changed } = observe(ctx, "check_suite", String(suite.id), state, suite);
        if (!changed) continue;
        const action = suite.status === "completed" ? "completed" : "requested";
        ctx.emit(
          "check_suite",
          action,
          String(suite.id),
          { action, check_suite: suite, repository: meta.repository, sender: meta.sender },
          state,
        );
      }
    }
  },
};
