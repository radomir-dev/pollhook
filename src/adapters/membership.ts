import type { Adapter, AdapterContext } from "../types.ts";
import { observe, orgAndSender } from "./common.ts";

const MAX_TEAMS = 10;
const REMOVED = "removed";

interface Meta {
  organization: { login: string };
  sender: Record<string, unknown>;
}

export const membership: Adapter = {
  name: "membership",
  scope: "org",
  intervalFloorMs: 300_000,
  async poll(ctx) {
    const teams = await ctx.gh.get<any[]>(`/orgs/${ctx.org}/teams?per_page=100`, {
      etagKey: `teams:membership:${ctx.org}`,
    });
    if (teams.notModified || !teams.data) return;
    const meta = await orgAndSender(ctx);
    const polled = new Set<string>();
    const current = new Set<string>();
    for (const team of teams.data.slice(0, MAX_TEAMS)) {
      polled.add(team.slug);
      await pollTeam(ctx, team, meta, current);
    }
    removeMissing(ctx, polled, current, meta);
  },
};

async function pollTeam(
  ctx: AdapterContext,
  team: any,
  meta: Meta,
  current: Set<string>,
): Promise<void> {
  const result = await ctx.gh.get<any[]>(
    `/orgs/${ctx.org}/teams/${encodeURIComponent(team.slug)}/members?per_page=100`,
    { etagKey: `team-members:${ctx.org}:${team.slug}` },
  );
  if (result.notModified || !result.data) {
    rememberStored(ctx, team.slug, current);
    return;
  }
  for (const user of result.data) {
    const key = `${team.slug}:${user.login}`;
    current.add(key);
    const state = String(user.id ?? user.login);
    const { changed, prev } = observe(ctx, "membership", key, state, { user, team });
    if (!changed) continue;
    const action = prev && prev.state !== REMOVED ? "edited" : "added";
    ctx.emit(
      "membership",
      action,
      key,
      { action, scope: "team", member: user, team, ...meta },
      `${state}:${action}`,
    );
  }
}

function rememberStored(ctx: AdapterContext, slug: string, current: Set<string>): void {
  for (const row of ctx.db.listSnapshots(ctx.repo, "membership")) {
    if (row.state !== REMOVED && row.key.startsWith(`${slug}:`)) current.add(row.key);
  }
}

function removeMissing(
  ctx: AdapterContext,
  polled: Set<string>,
  current: Set<string>,
  meta: Meta,
): void {
  for (const row of ctx.db.listSnapshots(ctx.repo, "membership")) {
    if (row.state === REMOVED || current.has(row.key)) continue;
    const slug = row.key.split(":")[0];
    if (!slug || !polled.has(slug)) continue;
    ctx.db.putSnapshot(ctx.repo, "membership", row.key, REMOVED, row.data);
    ctx.emit(
      "membership",
      "removed",
      row.key,
      { action: "removed", scope: "team", member: row.data.user, team: row.data.team, ...meta },
      `removed:${row.state}`,
    );
  }
}
