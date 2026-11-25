import type { Adapter } from "../types.ts";
import { sha256 } from "../util.ts";
import { observe, repoAndSender } from "./common.ts";

const REVIEWS_PER_PR = 10;

export const pullRequestReview: Adapter = {
  name: "pull_request_review",
  intervalFloorMs: 30_000,
  async poll(ctx) {
    const open = ctx.db
      .listSnapshots(ctx.repo, "pull_request")
      .filter((row) => row.data.state === "open")
      .slice(0, REVIEWS_PER_PR);
    if (open.length === 0) return;
    const meta = await repoAndSender(ctx);
    for (const row of open) {
      const result = await ctx.gh.get<any[]>(
        `/repos/${ctx.repo}/pulls/${row.key}/reviews?per_page=100`,
        { etagKey: `reviews:${ctx.repo}:${row.key}` },
      );
      if (result.notModified || !result.data) continue;
      for (const review of result.data) {
        const state = `${review.state}:${review.submitted_at}:${sha256(review.body ?? "")}`;
        const { changed, prev } = observe(
          ctx,
          "pull_request_review",
          `${row.key}:${review.id}`,
          state,
          review,
        );
        if (!changed) continue;
        const action = !prev ? "submitted" : review.state === "DISMISSED" ? "dismissed" : "edited";
        ctx.emit(
          "pull_request_review",
          action,
          `${row.key}:${review.id}`,
          {
            action,
            review,
            pull_request: { number: Number(row.key) },
            repository: meta.repository,
            sender: meta.sender,
          },
          state,
        );
      }
    }
  },
};
