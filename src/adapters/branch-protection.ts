import type { Adapter, AdapterContext } from "../types.ts";
import { isStatus, sha256 } from "../util.ts";
import { observe, repoAndSender } from "./common.ts";

const MAX_BRANCHES = 20;

async function fetchProtection(ctx: AdapterContext, branch: string): Promise<any | null> {
  try {
    const result = await ctx.gh.get<any>(
      `/repos/${ctx.repo}/branches/${encodeURIComponent(branch)}/protection`,
    );
    return result.data ?? null;
  } catch (error) {
    if (isStatus(error, 404) || isStatus(error, 403)) return null;
    throw error;
  }
}

export const branchProtection: Adapter = {
  name: "branch_protection_configuration",
  intervalFloorMs: 300_000,
  async poll(ctx) {
    const branches = await ctx.gh.get<any[]>(`/repos/${ctx.repo}/branches?per_page=100`, {
      etagKey: `branches:protection:${ctx.repo}`,
    });
    if (branches.notModified || !branches.data) return;
    const meta = await repoAndSender(ctx);

    for (const branch of branches.data.slice(0, MAX_BRANCHES)) {
      const protection = await fetchProtection(ctx, branch.name);
      if (protection === null) continue;
      const state = sha256(JSON.stringify(protection));
      const { changed, prev } = observe(
        ctx,
        "branch_protection_configuration",
        branch.name,
        state,
        protection,
      );
      if (!changed || !prev) continue;
      ctx.emit(
        "branch_protection_configuration",
        "edited",
        branch.name,
        {
          action: "edited",
          branch: branch.name,
          changes: { branch_protection: { from: prev.data, to: protection } },
          repository: meta.repository,
          sender: meta.sender,
        },
        state,
      );
    }
  },
};
