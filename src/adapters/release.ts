import type { Adapter } from "../types.ts";
import { sha256 } from "../util.ts";
import { observe, repoAndSender } from "./common.ts";

function actionFor(previous: any, current: any): string {
  if (!previous) return current.draft ? "created" : "published";
  if (previous.draft === true && current.draft === false) return "published";
  if (previous.prerelease === false && current.prerelease === true) return "prereleased";
  if (previous.prerelease === true && current.prerelease === false) return "released";
  return "edited";
}

export const release: Adapter = {
  name: "release",
  intervalFloorMs: 60_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any[]>(`/repos/${ctx.repo}/releases?per_page=30`, {
      etagKey: `releases:${ctx.repo}`,
    });
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    for (const item of result.data) {
      const state = `${item.draft}:${item.prerelease}:${item.published_at}:${item.tag_name}:${sha256(
        `${item.name ?? ""}\n${item.body ?? ""}`,
      )}`;
      const { changed, prev } = observe(ctx, "release", String(item.id), state, item);
      if (!changed) continue;
      const action = actionFor(prev?.data, item);
      ctx.emit(
        "release",
        action,
        String(item.id),
        { action, release: item, repository: meta.repository, sender: meta.sender },
        `${state}:${action}`,
      );
    }
  },
};
