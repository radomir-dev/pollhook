import type { Adapter } from "../types.ts";
import { sha256 } from "../util.ts";
import { observe, repoAndSender } from "./common.ts";

export const issueComment: Adapter = {
  name: "issue_comment",
  intervalFloorMs: 30_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any[]>(
      `/repos/${ctx.repo}/issues/comments?sort=updated&direction=desc&per_page=100`,
      { etagKey: `issue-comments:${ctx.repo}` },
    );
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    for (const comment of result.data) {
      const state = `${sha256(comment.body ?? "")}:${comment.updated_at}`;
      const { changed, prev } = observe(ctx, "issue_comment", String(comment.id), state, comment);
      if (!changed) continue;

      const action = prev ? "edited" : "created";
      const number = Number((comment.issue_url ?? "").split("/").pop());
      const issue =
        Number.isFinite(number) && number > 0
          ? (ctx.db.getSnapshot(ctx.repo, "issues", String(number))?.data ??
            ctx.db.getSnapshot(ctx.repo, "pull_request", String(number))?.data ?? { number })
          : null;

      ctx.emit(
        "issue_comment",
        action,
        String(comment.id),
        { action, issue, comment, repository: meta.repository, sender: meta.sender },
        `${state}:${action}`,
      );
    }
  },
};
