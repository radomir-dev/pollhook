import type { Adapter } from "../types.ts";
import { isStatus } from "../util.ts";
import { observe, repoAndSender } from "./common.ts";

export const pageBuild: Adapter = {
  name: "page_build",
  intervalFloorMs: 60_000,
  async poll(ctx) {
    let result;
    try {
      result = await ctx.gh.get<any[]>(`/repos/${ctx.repo}/pages/builds?per_page=20`, {
        etagKey: `pages:${ctx.repo}`,
      });
    } catch (error) {
      if (isStatus(error, 404)) return;
      throw error;
    }
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    for (const build of result.data) {
      const key = build.id != null ? String(build.id) : `${build.commit}:${build.updated_at}`;
      const { changed } = observe(ctx, "page_build", key, String(build.status), build);
      if (!changed) continue;
      ctx.emit(
        "page_build",
        null,
        key,
        { id: build.id, build, repository: meta.repository, sender: meta.sender },
        String(build.status),
      );
    }
  },
};
