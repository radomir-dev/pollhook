import type { Adapter, AdapterContext } from "../types.ts";
import { sha256 } from "../util.ts";
import { observe, orgAndSender } from "./common.ts";
import { PAGE_SIZE, projectsPath } from "./projects-v2.ts";

const DELETED = "deleted";

interface Meta {
  organization: { login: string };
  sender: Record<string, unknown>;
}

async function readItems(ctx: AdapterContext, project: any): Promise<any[]> {
  const base = `/orgs/${ctx.org}/projectsV2/${project.number}`;
  const fields = await ctx.gh.get<any[]>(`${base}/fields`);
  const ids = (fields.data ?? []).map((field) => field.id).join(",");
  const items = await ctx.gh.get<any[]>(`${base}/items?per_page=${PAGE_SIZE}&fields=${ids}`);
  return items.data ?? [];
}

function emitItem(
  ctx: AdapterContext,
  project: any,
  item: any,
  action: string,
  state: string,
  meta: Meta,
) {
  ctx.emit(
    "projects_v2_item",
    action,
    `${project.number}:${item.id}`,
    { action, projects_v2_item: { ...item, project_node_id: project.node_id }, ...meta },
    `${state}:${action}`,
  );
}

async function syncProject(ctx: AdapterContext, project: any, meta: Meta): Promise<void> {
  const items = await readItems(ctx, project);
  const prefix = `${project.number}:`;
  const present = new Set<string>();
  for (const item of items) {
    const key = `${prefix}${item.id}`;
    present.add(key);
    const state = `${item.updated_at}:${sha256(JSON.stringify(item.fields))}`;
    const { changed, prev } = observe(ctx, "projects_v2_item", key, state, item);
    if (!changed) continue;
    const action = prev && prev.state !== DELETED ? "edited" : "created";
    emitItem(ctx, project, item, action, state, meta);
  }
  if (items.length >= PAGE_SIZE) return;
  for (const row of ctx.db.listSnapshots(ctx.repo, "projects_v2_item")) {
    if (!row.key.startsWith(prefix) || row.state === DELETED || present.has(row.key)) continue;
    ctx.db.putSnapshot(ctx.repo, "projects_v2_item", row.key, DELETED, row.data);
    emitItem(ctx, project, row.data, "deleted", row.state, meta);
  }
}

export const projectsV2Item: Adapter = {
  name: "projects_v2_item",
  scope: "org",
  intervalFloorMs: 60_000,
  async poll(ctx) {
    if (!ctx.org) return;
    const result = await ctx.gh.get<any[]>(projectsPath(ctx.org), {
      etagKey: `project-items:${ctx.org}`,
    });
    if (result.notModified || !result.data) return;
    const meta = await orgAndSender(ctx);
    for (const project of result.data) {
      const key = `p:${project.number}`;
      if (ctx.db.getSnapshot(ctx.repo, "projects_v2_item", key)?.state === project.updated_at) {
        continue;
      }
      await syncProject(ctx, project, meta);
      ctx.db.putSnapshot(ctx.repo, "projects_v2_item", key, project.updated_at, {});
    }
  },
};
