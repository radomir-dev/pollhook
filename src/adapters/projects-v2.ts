import type { Adapter } from "../types.ts";
import { sha256 } from "../util.ts";
import { observe, orgAndSender, PAGE_SIZE, projectsPath } from "./common.ts";

const DELETED = "deleted";

function stateOf(project: any): string {
  const text = sha256(`${project.title}\n${project.description ?? ""}`);
  return `${project.closed_at ?? ""}:${project.public}:${text}`;
}

function actionFor(previous: any, current: any): string {
  if (!previous.closed_at && current.closed_at) return "closed";
  if (previous.closed_at && !current.closed_at) return "reopened";
  return "edited";
}

export const projectsV2: Adapter = {
  name: "projects_v2",
  scope: "org",
  intervalFloorMs: 60_000,
  async poll(ctx) {
    if (!ctx.org) return;
    const result = await ctx.gh.get<any[]>(projectsPath(ctx.org), {
      etagKey: `projects:${ctx.org}`,
    });
    if (result.notModified || !result.data) return;
    const meta = await orgAndSender(ctx);
    const emit = (action: string, project: any, state: string) =>
      ctx.emit(
        "projects_v2",
        action,
        String(project.number),
        { action, projects_v2: project, ...meta },
        `${state}:${action}`,
      );
    const current = new Set(result.data.map((project) => String(project.number)));

    for (const project of result.data) {
      const state = stateOf(project);
      const { changed, prev } = observe(ctx, "projects_v2", String(project.number), state, project);
      if (!changed) continue;
      emit(
        prev && prev.state !== DELETED ? actionFor(prev.data, project) : "created",
        project,
        state,
      );
    }
    if (result.data.length >= PAGE_SIZE) return;
    for (const row of ctx.db.listSnapshots(ctx.repo, "projects_v2")) {
      if (row.state === DELETED || current.has(row.key)) continue;
      ctx.db.putSnapshot(ctx.repo, "projects_v2", row.key, DELETED, row.data);
      emit("deleted", row.data, row.state);
    }
  },
};
