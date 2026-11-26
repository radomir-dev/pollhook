import type { Adapter } from "../types.ts";
import { diffList, orgAndSender, PAGE_SIZE } from "./common.ts";

const ACTIONS = { created: "blocked", edited: "blocked", deleted: "unblocked" } as const;

export const orgBlock: Adapter = {
  name: "org_block",
  scope: "org",
  intervalFloorMs: 60_000,
  async poll(ctx) {
    if (!ctx.org) return;
    const result = await ctx.gh.get<any[]>(`/orgs/${ctx.org}/blocks?per_page=${PAGE_SIZE}`, {
      etagKey: `org-blocks:${ctx.org}`,
    });
    if (result.notModified || !result.data) return;
    const meta = await orgAndSender(ctx);
    const entries = result.data.map((user) => ({
      key: user.login,
      state: String(user.id),
      item: user,
    }));
    diffList(ctx, "org_block", entries, entries.length < PAGE_SIZE, (change, user, stamp) => {
      const action = ACTIONS[change];
      ctx.emit(
        "org_block",
        action,
        user.login,
        { action, blocked_user: user, ...meta },
        `${stamp}:${action}`,
      );
    });
  },
};
