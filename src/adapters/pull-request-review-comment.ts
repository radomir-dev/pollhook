import type { Adapter } from "../types.ts";
import { sha256 } from "../util.ts";
import { observe, repoAndSender } from "./common.ts";

export const pullRequestReviewComment: Adapter = {
  name: "pull_request_review_comment",
  intervalFloorMs: 30_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any[]>(
      `/repos/${ctx.repo}/pulls/comments?sort=updated&direction=desc&per_page=100`,
      { etagKey: `review-comments:${ctx.repo}` },
    );
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    for (const comment of result.data) {
      const state = `${sha256(comment.body ?? "")}:${comment.updated_at}`;
      const { changed, prev } = observe(
        ctx,
        "pull_request_review_comment",
        String(comment.id),
        state,
        comment,
      );
      if (!changed) continue;
      const action = prev ? "edited" : "created";
      const number = Number((comment.pull_request_url ?? "").split("/").pop());
      const pullRequest = Number.isFinite(number)
        ? (ctx.db.getSnapshot(ctx.repo, "pull_request", String(number))?.data ?? { number })
        : { number: null };
      ctx.emit(
        "pull_request_review_comment",
        action,
        String(comment.id),
        {
          action,
          pull_request: pullRequest,
          comment,
          repository: meta.repository,
          sender: meta.sender,
        },
        `${state}:${action}`,
      );
    }
  },
};
