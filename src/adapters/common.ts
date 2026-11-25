import type { AdapterContext, EventName, RepoInfo, Snapshot } from "../types.ts";

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

export const SUCCESS_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

export const FAILED_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "stale",
]);

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
