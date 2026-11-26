import type { Adapter, AdapterContext } from "../types.ts";
import { repoAndSender } from "./common.ts";

const ISSUES_PATH = "issues?state=all&sort=updated&direction=desc&per_page=100";

interface Meta {
  repository: unknown;
  sender: unknown;
}

function repositoryOf(ctx: AdapterContext, blocker: any, meta: Meta): unknown {
  const fullName = String(blocker.repository_url).replace(/^.*\/repos\//, "");
  if (fullName === ctx.repo) return meta.repository;
  return { full_name: fullName, html_url: `https://github.com/${fullName}` };
}

async function syncBlockers(
  ctx: AdapterContext,
  issue: any,
  total: string,
  meta: Meta,
): Promise<void> {
  const key = String(issue.number);
  const known = ctx.db.getSnapshot(ctx.repo, "issue_dependencies", key)?.data;
  const result = await ctx.gh.get<any[]>(
    `/repos/${ctx.repo}/issues/${issue.number}/dependencies/blocked_by?per_page=100`,
  );
  const previous: any[] = known?.blockers ?? [];
  const current = result.data ?? [];
  const revision = (known?.revision ?? 0) + 1;
  const changes = [
    ...current
      .filter((blocker) => !previous.some((other) => other.id === blocker.id))
      .map((blocker) => ({ action: "blocked_by_added", blocker })),
    ...previous
      .filter((blocker) => !current.some((other) => other.id === blocker.id))
      .map((blocker) => ({ action: "blocked_by_removed", blocker })),
  ];
  ctx.db.putSnapshot(ctx.repo, "issue_dependencies", key, total, { blockers: current, revision });
  for (const { action, blocker } of changes) {
    ctx.emit(
      "issue_dependencies",
      action,
      `${issue.number}:${blocker.id}`,
      {
        action,
        blocked_issue_id: issue.id,
        blocked_issue: issue,
        blocking_issue_id: blocker.id,
        blocking_issue: blocker,
        blocking_issue_repo: repositoryOf(ctx, blocker, meta),
        repository: meta.repository,
        sender: meta.sender,
      },
      `${action}:${blocker.id}:${revision}`,
    );
  }
}

export const issueDependencies: Adapter = {
  name: "issue_dependencies",
  intervalFloorMs: 30_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any[]>(`/repos/${ctx.repo}/${ISSUES_PATH}`, {
      etagKey: `issue-dependencies:${ctx.repo}`,
    });
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    for (const issue of result.data) {
      if (issue.pull_request) continue;
      const total = String(issue.issue_dependencies_summary?.total_blocked_by ?? 0);
      const known = ctx.db.getSnapshot(ctx.repo, "issue_dependencies", String(issue.number));
      if ((known?.state ?? "0") === total) continue;
      await syncBlockers(ctx, issue, total, meta);
    }
  },
};
