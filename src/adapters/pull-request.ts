import type { Adapter } from "../types.ts";
import { observe, repoAndSender } from "./common.ts";

function actionsFor(prev: any, current: any): string[] {
  if (!prev) return ["opened"];
  const actions: string[] = [];
  if (prev.state === "open" && current.state === "closed") actions.push("closed");
  else if (prev.state === "closed" && current.state === "open") actions.push("reopened");
  if (prev.head?.sha && current.head?.sha && prev.head.sha !== current.head.sha)
    actions.push("synchronize");
  if (prev.draft === false && current.draft === true) actions.push("converted_to_draft");
  if (prev.draft === true && current.draft === false) actions.push("ready_for_review");
  const previousLabels = new Set((prev.labels ?? []).map((label: any) => label.name));
  const added = (current.labels ?? []).find((label: any) => !previousLabels.has(label.name));
  if (added) actions.push("labeled");
  return actions.length > 0 ? actions : ["edited"];
}

export const pullRequest: Adapter = {
  name: "pull_request",
  intervalFloorMs: 10_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any[]>(
      `/repos/${ctx.repo}/pulls?state=all&sort=updated&direction=desc&per_page=50`,
      { etagKey: `pulls:${ctx.repo}` },
    );
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    for (const pull of result.data) {
      const labels = (pull.labels ?? [])
        .map((label: any) => label.name)
        .sort()
        .join(",");
      const state = `${pull.state}:${pull.draft}:${pull.head?.sha}:${pull.merged}:${labels}:${pull.mergeable}`;
      const { changed, prev } = observe(ctx, "pull_request", String(pull.number), state, pull);
      if (!changed) continue;
      for (const action of actionsFor(prev?.data, pull)) {
        ctx.emit(
          "pull_request",
          action,
          String(pull.number),
          {
            action,
            number: pull.number,
            pull_request: pull,
            repository: meta.repository,
            sender: meta.sender,
          },
          `${state}:${action}`,
        );
      }
    }
  },
};
