import type { Adapter } from "../types.ts";
import { observe, repoAndSender } from "./common.ts";

export const fork: Adapter = {
  name: "fork",
  intervalFloorMs: 60_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any[]>(`/repos/${ctx.repo}/forks?sort=newest&per_page=100`, {
      etagKey: `forks:${ctx.repo}`,
    });
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    for (const forkee of result.data) {
      const key = String(forkee.id);
      const { changed } = observe(ctx, "fork", key, String(forkee.created_at ?? ""), forkee);
      if (!changed) continue;
      ctx.emit("fork", null, key, { forkee, repository: meta.repository, sender: meta.sender }, key);
    }
  },
};
