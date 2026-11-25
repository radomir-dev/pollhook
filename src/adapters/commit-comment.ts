import type { Adapter } from "../types.ts";
import { sha256 } from "../util.ts";
import { observe, repoAndSender } from "./common.ts";

export const commitComment: Adapter = {
  name: "commit_comment",
  intervalFloorMs: 60_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any[]>(
      `/repos/${ctx.repo}/comments?sort=updated&direction=desc&per_page=100`,
      { etagKey: `commit-comments:${ctx.repo}` },
    );
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    for (const comment of result.data) {
      const state = `${sha256(comment.body ?? "")}:${comment.updated_at}`;
      const { changed, prev } = observe(ctx, "commit_comment", String(comment.id), state, comment);
      if (!changed) continue;
      const action = prev ? "edited" : "created";
      ctx.emit(
        "commit_comment",
        action,
        String(comment.id),
        { action, comment, repository: meta.repository, sender: meta.sender },
        `${state}:${action}`,
      );
    }
  },
};
