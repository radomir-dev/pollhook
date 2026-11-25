import type { Adapter } from "../types.ts";
import { observe, repoAndSender } from "./common.ts";

export const commitStatus: Adapter = {
  name: "status",
  intervalFloorMs: 30_000,
  async poll(ctx) {
    if (ctx.refs.length === 0) return;
    const meta = await repoAndSender(ctx);
    for (const ref of ctx.refs) {
      const result = await ctx.gh.get<any[]>(
        `/repos/${ctx.repo}/commits/${encodeURIComponent(ref)}/statuses?per_page=100`,
        { etagKey: `statuses:${ctx.repo}:${ref}` },
      );
      if (result.notModified || !result.data) continue;
      for (const status of result.data) {
        const state = `${status.state}:${status.updated_at}`;
        const { changed } = observe(ctx, "status", String(status.id), state, status);
        if (!changed) continue;
        ctx.emit(
          "status",
          null,
          String(status.id),
          {
            id: status.id,
            sha: status.sha,
            state: status.state,
            context: status.context,
            description: status.description,
            target_url: status.target_url,
            created_at: status.created_at,
            updated_at: status.updated_at,
            repository: meta.repository,
            sender: meta.sender,
          },
          state,
        );
      }
    }
  },
};
