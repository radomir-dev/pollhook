import type { Adapter } from "../types.ts";
import { observe, repoAndSender } from "./common.ts";

export const repositoryAdvisory: Adapter = {
  name: "repository_advisory",
  intervalFloorMs: 300_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any[]>(
      `/repos/${ctx.repo}/security-advisories?per_page=100`,
      { etagKey: `advisories:${ctx.repo}` },
    );
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    for (const advisory of result.data) {
      const key = String(advisory.ghsa_id);
      const state = `${advisory.state}:${advisory.updated_at}:${advisory.severity ?? ""}`;
      const { changed, prev } = observe(ctx, "repository_advisory", key, state, advisory);
      if (!changed) continue;
      const action = !prev ? "published" : advisory.state === "closed" ? "closed" : "updated";
      ctx.emit(
        "repository_advisory",
        action,
        key,
        {
          action,
          repository_advisory: advisory,
          repository: meta.repository,
          sender: meta.sender,
        },
        `${state}:${action}`,
      );
    }
  },
};
