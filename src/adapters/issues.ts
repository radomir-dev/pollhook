import type { Adapter } from "../types.ts";
import { sha256 } from "../util.ts";
import { observe, repoAndSender } from "./common.ts";

function actionsFor(previous: any, current: any): string[] {
  if (!previous) return ["opened"];
  if (previous.state === "open" && current.state === "closed") return ["closed"];
  if (previous.state === "closed" && current.state === "open") return ["reopened"];
  const before = new Set((previous.labels ?? []).map((label: any) => label.name));
  const after = new Set((current.labels ?? []).map((label: any) => label.name));
  const added = [...after].some((name) => !before.has(name as string));
  if (added) return ["labeled"];
  const removed = [...before].some((name) => !after.has(name));
  if (removed) return ["unlabeled"];
  return ["edited"];
}

export const issues: Adapter = {
  name: "issues",
  intervalFloorMs: 30_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any[]>(
      `/repos/${ctx.repo}/issues?state=all&sort=updated&direction=desc&per_page=100`,
      { etagKey: `issues:${ctx.repo}` },
    );
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    for (const issue of result.data) {
      if (issue.pull_request) continue;
      const labels = (issue.labels ?? []).map((label: any) => label.name).sort().join(",");
      const body = sha256(`${issue.title}\n${issue.body ?? ""}`);
      const state = `${issue.state}:${labels}:${body}`;
      const { changed, prev } = observe(ctx, "issues", String(issue.number), state, issue);
      if (!changed) continue;
      for (const action of actionsFor(prev?.data, issue)) {
        ctx.emit(
          "issues",
          action,
          String(issue.number),
          { action, issue, repository: meta.repository, sender: meta.sender },
          `${state}:${action}`,
        );
      }
    }
  },
};
