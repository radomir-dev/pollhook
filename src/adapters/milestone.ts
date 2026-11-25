import type { Adapter } from "../types.ts";
import { sha256 } from "../util.ts";
import { observe, repoAndSender } from "./common.ts";

const DELETED = "deleted";

function actionFor(previous: any, current: any): string {
  if (!previous) return "created";
  if (previous.state === "open" && current.state === "closed") return "closed";
  if (previous.state === "closed" && current.state === "open") return "reopened";
  return "edited";
}

function stateFor(milestone: any): string {
  return `${milestone.state}:${sha256(`${milestone.title}\n${milestone.description ?? ""}`)}:${
    milestone.due_on
  }:${milestone.open_issues}:${milestone.closed_issues}`;
}

export const milestone: Adapter = {
  name: "milestone",
  intervalFloorMs: 60_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any[]>(`/repos/${ctx.repo}/milestones?state=all&per_page=100`, {
      etagKey: `milestones:${ctx.repo}`,
    });
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    const current = new Set(result.data.map((item) => String(item.number)));

    for (const item of result.data) {
      const key = String(item.number);
      const state = stateFor(item);
      const { changed, prev } = observe(ctx, "milestone", key, state, item);
      if (!changed) continue;
      const action = prev && prev.state !== DELETED ? actionFor(prev.data, item) : "created";
      ctx.emit(
        "milestone",
        action,
        key,
        { action, milestone: item, repository: meta.repository, sender: meta.sender },
        `${state}:${action}`,
      );
    }

    for (const row of ctx.db.listSnapshots(ctx.repo, "milestone")) {
      if (row.state === DELETED || current.has(row.key)) continue;
      ctx.db.putSnapshot(ctx.repo, "milestone", row.key, DELETED, row.data);
      ctx.emit(
        "milestone",
        "deleted",
        row.key,
        {
          action: "deleted",
          milestone: row.data,
          repository: meta.repository,
          sender: meta.sender,
        },
        `deleted:${row.state}`,
      );
    }
  },
};
