import type { Adapter, AdapterContext, GetResult } from "../types.ts";
import { sha256 } from "../util.ts";
import { observe } from "./common.ts";

function stateFor(repo: any): string {
  return sha256(
    [
      repo.full_name,
      repo.private,
      repo.visibility ?? "",
      repo.description ?? "",
      repo.default_branch,
      repo.archived,
      repo.disabled,
      (repo.topics ?? []).join(","),
      repo.homepage ?? "",
    ].join("|"),
  );
}

async function fetchRepo(ctx: AdapterContext, scope: string): Promise<GetResult<any>> {
  return ctx.gh.get<any>(`/repos/${ctx.repo}`, { etagKey: `repo:${scope}:${ctx.repo}` });
}

export const repository: Adapter = {
  name: "repository",
  intervalFloorMs: 60_000,
  async poll(ctx) {
    const result = await fetchRepo(ctx, "repository");
    if (result.notModified || !result.data) return;
    const current = result.data;
    const state = stateFor(current);
    const { changed, prev } = observe(ctx, "repository", ctx.repo, state, current);
    if (!changed) return;
    const sender = await ctx.gh.sender();
    const previous = prev?.data;
    const actions: string[] = [];
    if (previous) {
      if (previous.full_name !== current.full_name) actions.push("renamed");
      if (previous.archived !== current.archived) {
        actions.push(current.archived ? "archived" : "unarchived");
      }
      if (previous.private !== current.private || previous.visibility !== current.visibility) {
        actions.push(current.private ? "privatized" : "publicized");
      }
      if (previous.description !== current.description) actions.push("edited");
    } else {
      actions.push("edited");
    }
    for (const action of actions) {
      ctx.emit(
        "repository",
        action,
        ctx.repo,
        { action, repository: current, sender },
        `${state}:${action}`,
      );
    }
  },
};

export const publicEvent: Adapter = {
  name: "public",
  intervalFloorMs: 60_000,
  async poll(ctx) {
    const result = await fetchRepo(ctx, "public");
    if (result.notModified || !result.data) return;
    const current = result.data;
    const state = stateFor(current);
    const { changed, prev } = observe(ctx, "public", ctx.repo, state, current);
    if (!changed || !prev) return;
    if (prev.data.private !== true || current.private !== false) return;
    const sender = await ctx.gh.sender();
    ctx.emit("public", null, ctx.repo, { repository: current, sender }, state);
  },
};
