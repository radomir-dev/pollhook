import type { Adapter, AdapterContext } from "../types.ts";
import { sha256 } from "../util.ts";
import { DISCUSSIONS_PATH, observe, repoAndSender } from "./common.ts";

const MAX_FETCHES_PER_ROUND = 10;
const BASELINE_KEY = "baseline";

const markerOf = (discussion: any): string => `${discussion.updated_at}:${discussion.comments}`;

function recordBaseline(ctx: AdapterContext, discussions: any[]): void {
  for (const item of discussions) {
    ctx.db.putSnapshot(ctx.repo, "discussion_comment", `d:${item.number}`, markerOf(item), {
      updated_at: item.updated_at,
    });
  }
  ctx.db.putSnapshot(ctx.repo, "discussion_comment", BASELINE_KEY, "1", {});
}

async function readComments(ctx: AdapterContext, item: any): Promise<any[]> {
  const result = await ctx.gh.get<any[]>(
    `/repos/${ctx.repo}/discussions/${item.number}/comments?per_page=100`,
  );
  return result.data ?? [];
}

export const discussionComment: Adapter = {
  name: "discussion_comment",
  intervalFloorMs: 30_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any[]>(`/repos/${ctx.repo}/${DISCUSSIONS_PATH}`, {
      etagKey: `discussion-comments:${ctx.repo}`,
    });
    if (result.notModified || !result.data) return;
    if (!ctx.db.getSnapshot(ctx.repo, "discussion_comment", BASELINE_KEY)) {
      recordBaseline(ctx, result.data);
      return;
    }
    const meta = await repoAndSender(ctx);
    let fetched = 0;
    for (const item of result.data) {
      const marker = ctx.db.getSnapshot(ctx.repo, "discussion_comment", `d:${item.number}`);
      if (marker?.state === markerOf(item)) continue;
      if (fetched >= MAX_FETCHES_PER_ROUND) break;
      fetched += 1;
      const comments = await readComments(ctx, item);
      emitComments(ctx, item, comments, marker?.data?.updated_at, meta);
      ctx.db.putSnapshot(ctx.repo, "discussion_comment", `d:${item.number}`, markerOf(item), {
        updated_at: item.updated_at,
      });
    }
  },
};

function emitComments(
  ctx: AdapterContext,
  item: any,
  comments: any[],
  knownUpTo: string | undefined,
  meta: { repository: unknown; sender: unknown },
): void {
  for (const comment of comments) {
    const state = `${sha256(comment.body ?? "")}:${comment.updated_at}`;
    const { changed, prev } = observe(ctx, "discussion_comment", `c:${comment.id}`, state, comment);
    if (!changed) continue;
    if (!prev && knownUpTo && comment.created_at <= knownUpTo) continue;
    const action = prev ? "edited" : "created";
    ctx.emit(
      "discussion_comment",
      action,
      String(comment.id),
      { action, discussion: item, comment, repository: meta.repository, sender: meta.sender },
      `${state}:${action}`,
    );
  }
}
