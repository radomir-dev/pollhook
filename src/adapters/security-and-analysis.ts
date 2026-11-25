import type { Adapter } from "../types.ts";
import { sha256 } from "../util.ts";
import { observe, repoAndSender } from "./common.ts";

export const securityAndAnalysis: Adapter = {
  name: "security_and_analysis",
  intervalFloorMs: 300_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any>(`/repos/${ctx.repo}`, {
      etagKey: `repo:security_and_analysis:${ctx.repo}`,
    });
    if (result.notModified || !result.data) return;
    const current = result.data.security_and_analysis ?? {};
    const state = sha256(JSON.stringify(current));
    const { changed, prev } = observe(ctx, "security_and_analysis", ctx.repo, state, current);
    if (!changed || !prev) return;
    const meta = await repoAndSender(ctx);
    ctx.emit(
      "security_and_analysis",
      null,
      ctx.repo,
      {
        changes: { security_and_analysis: { from: prev.data, to: current } },
        repository: meta.repository,
        sender: meta.sender,
      },
      state,
    );
  },
};
