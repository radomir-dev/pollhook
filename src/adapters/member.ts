import type { Adapter } from "../types.ts";
import { sha256 } from "../util.ts";
import { observe, repoAndSender } from "./common.ts";

const REMOVED = "removed";

function stateFor(user: any): string {
  const permissions = user.permissions ?? {};
  const ordered = Object.keys(permissions)
    .sort()
    .map((name) => `${name}:${permissions[name]}`)
    .join("|");
  return sha256(ordered);
}

export const member: Adapter = {
  name: "member",
  intervalFloorMs: 300_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any[]>(`/repos/${ctx.repo}/collaborators?per_page=100`, {
      etagKey: `collaborators:${ctx.repo}`,
    });
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    const current = new Set(result.data.map((user) => user.login));

    for (const user of result.data) {
      const state = stateFor(user);
      const { changed, prev } = observe(ctx, "member", user.login, state, user);
      if (!changed) continue;
      const action = prev && prev.state !== REMOVED ? "edited" : "added";
      ctx.emit(
        "member",
        action,
        user.login,
        { action, member: user, repository: meta.repository, sender: meta.sender },
        `${state}:${action}`,
      );
    }

    for (const row of ctx.db.listSnapshots(ctx.repo, "member")) {
      if (row.state === REMOVED || current.has(row.key)) continue;
      ctx.db.putSnapshot(ctx.repo, "member", row.key, REMOVED, row.data);
      ctx.emit(
        "member",
        "removed",
        row.key,
        { action: "removed", member: row.data, repository: meta.repository, sender: meta.sender },
        `removed:${row.state}`,
      );
    }
  },
};
