import type { Adapter } from "../types.ts";
import { sha256 } from "../util.ts";
import { observe, repoAndSender } from "./common.ts";

const DELETED = "deleted";

function stateFor(label: any): string {
  return sha256(`${label.name}|${label.color}|${label.description ?? ""}|${label.default}`);
}

export const label: Adapter = {
  name: "label",
  intervalFloorMs: 60_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any[]>(`/repos/${ctx.repo}/labels?per_page=100`, {
      etagKey: `labels:${ctx.repo}`,
    });
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    const current = new Set(result.data.map((item) => item.name));

    for (const item of result.data) {
      const state = stateFor(item);
      const { changed, prev } = observe(ctx, "label", item.name, state, item);
      if (!changed) continue;
      const action = prev && prev.state !== DELETED ? "edited" : "created";
      ctx.emit(
        "label",
        action,
        item.name,
        { action, label: item, repository: meta.repository, sender: meta.sender },
        `${state}:${action}`,
      );
    }

    for (const row of ctx.db.listSnapshots(ctx.repo, "label")) {
      if (row.state === DELETED || current.has(row.key)) continue;
      ctx.db.putSnapshot(ctx.repo, "label", row.key, DELETED, row.data);
      ctx.emit(
        "label",
        "deleted",
        row.key,
        { action: "deleted", label: row.data, repository: meta.repository, sender: meta.sender },
        `deleted:${row.state}`,
      );
    }
  },
};
