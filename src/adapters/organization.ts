import type { Adapter, AdapterContext } from "../types.ts";
import { diffList, orgAndSender, PAGE_SIZE } from "./common.ts";

type Meta = Awaited<ReturnType<typeof orgAndSender>>;

async function pollProfile(ctx: AdapterContext, meta: Meta): Promise<void> {
  const result = await ctx.gh.get<any>(`/orgs/${ctx.org}`, { etagKey: `org:${ctx.org}` });
  const org = result.data;
  if (result.notModified || !org) return;
  const previous = ctx.db.getSnapshot(ctx.repo, "organization", "profile");
  const state = `${org.id}:${org.login}`;
  if (previous?.state === state) return;
  ctx.db.putSnapshot(ctx.repo, "organization", "profile", state, org);
  if (!previous || previous.data.login === org.login) return;
  ctx.emit(
    "organization",
    "renamed",
    "profile",
    {
      action: "renamed",
      changes: { login: { from: previous.data.login } },
      organization: org,
      sender: meta.sender,
    },
    `${state}:renamed`,
  );
}

async function pollMembers(ctx: AdapterContext, meta: Meta): Promise<void> {
  const result = await ctx.gh.get<any[]>(`/orgs/${ctx.org}/members?per_page=${PAGE_SIZE}`, {
    etagKey: `org-members:${ctx.org}`,
  });
  if (result.notModified || !result.data) return;
  const entries = result.data.map((user) => ({
    key: `m:${user.login}`,
    state: String(user.id),
    item: user,
  }));
  diffList(
    ctx,
    "organization",
    entries,
    entries.length < PAGE_SIZE,
    (change, user, stamp) => {
      const action = change === "deleted" ? "member_removed" : "member_added";
      ctx.emit(
        "organization",
        action,
        `m:${user.login}`,
        { action, membership: { state: "active", user }, ...meta },
        `${stamp}:${action}`,
      );
    },
    "m:",
  );
}

async function pollInvitations(ctx: AdapterContext, meta: Meta): Promise<void> {
  const result = await ctx.gh.get<any[]>(`/orgs/${ctx.org}/invitations?per_page=${PAGE_SIZE}`, {
    etagKey: `org-invitations:${ctx.org}`,
  });
  if (result.notModified || !result.data) return;
  const entries = result.data.map((invitation) => ({
    key: `i:${invitation.id}`,
    state: String(invitation.id),
    item: invitation,
  }));
  diffList(ctx, "organization", entries, false, (change, invitation, stamp) => {
    if (change === "edited") return;
    ctx.emit(
      "organization",
      "member_invited",
      `i:${invitation.id}`,
      { action: "member_invited", invitation, ...meta },
      `${stamp}:member_invited`,
    );
  });
}

export const organization: Adapter = {
  name: "organization",
  scope: "org",
  intervalFloorMs: 60_000,
  async poll(ctx) {
    if (!ctx.org) return;
    const meta = await orgAndSender(ctx);
    await pollProfile(ctx, meta);
    await pollMembers(ctx, meta);
    await pollInvitations(ctx, meta);
  },
};
