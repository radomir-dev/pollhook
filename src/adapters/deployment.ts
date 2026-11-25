import type { Adapter } from "../types.ts";
import { observe, repoAndSender } from "./common.ts";

export const deployment: Adapter = {
  name: "deployment",
  intervalFloorMs: 300_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any[]>(`/repos/${ctx.repo}/deployments?per_page=30`, {
      etagKey: `deployments:${ctx.repo}`,
    });
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    for (const item of result.data) {
      const state = String(item.created_at ?? item.id);
      const { changed } = observe(ctx, "deployment", String(item.id), state, item);
      if (!changed) continue;
      ctx.emit(
        "deployment",
        "created",
        String(item.id),
        { action: "created", deployment: item, repository: meta.repository, sender: meta.sender },
        state,
      );
    }
  },
};
