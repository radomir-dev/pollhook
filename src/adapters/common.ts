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

export const SUCCESS_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

export const FAILED_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "stale",
]);
