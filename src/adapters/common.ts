import type { AdapterContext, EventName, RepoInfo, Snapshot } from "../types.ts";

export const PAGE_SIZE = 100;
export const projectsPath = (org: string): string =>
  `/orgs/${org}/projectsV2?per_page=${PAGE_SIZE}`;
export const DISCUSSIONS_PATH = "discussions?sort=updated&direction=desc&per_page=100";

export interface Observation {
  changed: boolean;
  prev: Snapshot | null;
}

export async function repoAndSender(
  ctx: AdapterContext,
): Promise<{ repository: RepoInfo; sender: Record<string, unknown> }> {
  const [repository, sender] = await Promise.all([ctx.gh.repoInfo(ctx.repo), ctx.gh.sender()]);
  return { repository, sender };
}

export function observe(
  ctx: AdapterContext,
  event: EventName,
  key: string,
  state: string,
  data: unknown,
): Observation {
  const prev = ctx.db.getSnapshot(ctx.repo, event, key);
  if (prev?.state === state) return { changed: false, prev };
  ctx.db.putSnapshot(ctx.repo, event, key, state, data);
  return { changed: true, prev };
}

export async function orgAndSender(
  ctx: AdapterContext,
): Promise<{ organization: { login: string }; sender: Record<string, unknown> }> {
  const sender = await ctx.gh.sender();
  return { organization: { login: ctx.org ?? "" }, sender };
}

export async function observeAlerts(
  ctx: AdapterContext,
  event: EventName,
  alerts: any[],
  toAction: (previous: any, current: any) => string,
  stateFor: (alert: any) => string,
): Promise<void> {
  if (alerts.length === 0) return;
  const meta = await repoAndSender(ctx);
  for (const alert of alerts) {
    const state = stateFor(alert);
    const { changed, prev } = observe(ctx, event, String(alert.number), state, alert);
    if (!changed) continue;
    const action = toAction(prev?.data, alert);
    ctx.emit(
      event,
      action,
      String(alert.number),
      { action, alert, repository: meta.repository, sender: meta.sender },
      `${state}:${action}`,
    );
  }
}

export type Change = "created" | "edited" | "deleted";

export interface ListEntry {
  key: string;
  state: string;
  item: any;
}

const GONE = "deleted";

export function diffList(
  ctx: AdapterContext,
  event: EventName,
  entries: ListEntry[],
  complete: boolean,
  onChange: (change: Change, item: any, stamp: string, previous: any) => void,
  prefix = "",
): void {
  const seen = new Set(entries.map((entry) => entry.key));
  for (const { key, state, item } of entries) {
    const { changed, prev } = observe(ctx, event, key, state, item);
    if (!changed) continue;
    const change = prev && prev.state !== GONE ? "edited" : "created";
    onChange(change, item, `${state}:${prev?.updatedAt ?? ""}`, prev?.data);
  }
  if (!complete) return;
  for (const row of ctx.db.listSnapshots(ctx.repo, event)) {
    if (!row.key.startsWith(prefix) || row.state === GONE || seen.has(row.key)) continue;
    ctx.db.putSnapshot(ctx.repo, event, row.key, GONE, row.data);
    onChange("deleted", row.data, `deleted:${row.updatedAt}`, row.data);
  }
}
