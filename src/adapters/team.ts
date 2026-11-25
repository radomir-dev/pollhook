import type { Adapter } from "../types.ts";
import { sha256 } from "../util.ts";
import { observe } from "./common.ts";

const DELETED = "deleted";

export const team: Adapter = {
  name: "team",
  scope: "org",
  intervalFloorMs: 300_000,
  async poll(ctx) {
    if (!ctx.org) return;
    const result = await ctx.gh.get<any[]>(`/orgs/${ctx.org}/teams?per_page=100`, {
      etagKey: `teams:${ctx.org}`,
    });
    if (result.notModified || !result.data) return;
    const sender = await ctx.gh.sender();
    const organization = { login: ctx.org };
    const current = new Set(result.data.map((item) => String(item.id)));

    for (const item of result.data) {
      const state = sha256(JSON.stringify(item));
      const { changed, prev } = observe(ctx, "team", String(item.id), state, item);
      if (!changed) continue;
      const action = prev && prev.state !== DELETED ? "edited" : "created";
      ctx.emit(
        "team",
        action,
        String(item.id),
        { action, team: item, organization, sender },
        `${state}:${action}`,
      );
    }

    for (const row of ctx.db.listSnapshots(ctx.repo, "team")) {
      if (row.state === DELETED || current.has(row.key)) continue;
      ctx.db.putSnapshot(ctx.repo, "team", row.key, DELETED, row.data);
      ctx.emit(
        "team",
        "deleted",
        row.key,
        { action: "deleted", team: row.data, organization, sender },
        `deleted:${row.state}`,
      );
    }
  },
};
