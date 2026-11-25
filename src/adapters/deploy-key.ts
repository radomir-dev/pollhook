import type { Adapter } from "../types.ts";
import { sha256 } from "../util.ts";
import { observe, repoAndSender } from "./common.ts";

const DELETED = "deleted";

function stateFor(key: any): string {
  return sha256(`${key.title}|${key.key}|${key.read_only}`);
}

export const deployKey: Adapter = {
  name: "deploy_key",
  intervalFloorMs: 300_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any[]>(`/repos/${ctx.repo}/keys?per_page=100`, {
      etagKey: `deploy-keys:${ctx.repo}`,
    });
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    const current = new Set(result.data.map((key) => String(key.id)));

    for (const key of result.data) {
      const state = stateFor(key);
      const { changed, prev } = observe(ctx, "deploy_key", String(key.id), state, key);
      if (!changed) continue;
      if (prev && prev.state !== DELETED) continue;
      ctx.emit(
        "deploy_key",
        "created",
        String(key.id),
        { action: "created", key, repository: meta.repository, sender: meta.sender },
        state,
      );
    }

    for (const row of ctx.db.listSnapshots(ctx.repo, "deploy_key")) {
      if (row.state === DELETED || current.has(row.key)) continue;
      ctx.db.putSnapshot(ctx.repo, "deploy_key", row.key, DELETED, row.data);
      ctx.emit(
        "deploy_key",
        "deleted",
        row.key,
        { action: "deleted", key: row.data, repository: meta.repository, sender: meta.sender },
        `deleted:${row.state}`,
      );
    }
  },
};
