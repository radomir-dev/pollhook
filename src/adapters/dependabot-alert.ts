import type { Adapter } from "../types.ts";
import { observeAlerts } from "./common.ts";

function actionFor(previous: any, current: any): string {
  if (!previous) return "created";
  if (previous.state === current.state) return "edited";
  if (current.state === "open") return "reopened";
  if (current.state === "dismissed") return "dismissed";
  if (current.state === "auto_dismissed") return "auto_dismissed";
  if (current.state === "fixed") return "fixed";
  return "edited";
}

export const dependabotAlert: Adapter = {
  name: "dependabot_alert",
  intervalFloorMs: 300_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any[]>(
      `/repos/${ctx.repo}/dependabot/alerts?state=open,dismissed,fixed,auto_dismissed&per_page=100`,
      { etagKey: `dependabot:${ctx.repo}` },
    );
    if (result.notModified || !result.data) return;
    await observeAlerts(
      ctx,
      "dependabot_alert",
      result.data,
      actionFor,
      (alert) => `${alert.state}:${alert.updated_at}`,
    );
  },
};
