import type { Adapter } from "../types.ts";
import { observeAlerts } from "./common.ts";

const STATES = ["open", "dismissed", "fixed"] as const;

function actionFor(previous: any, current: any): string {
  if (!previous) return "created";
  if (previous.state === current.state) return "edited";
  if (current.state === "open") return "reopened";
  if (current.state === "fixed") return "fixed";
  return "closed";
}

export const codeScanningAlert: Adapter = {
  name: "code_scanning_alert",
  intervalFloorMs: 300_000,
  async poll(ctx) {
    const alerts: any[] = [];
    const seen = new Set<string>();
    for (const state of STATES) {
      const result = await ctx.gh.get<any[]>(
        `/repos/${ctx.repo}/code-scanning/alerts?state=${state}&per_page=100`,
        { etagKey: `code-scanning:${state}:${ctx.repo}` },
      );
      if (result.notModified || !result.data) continue;
      for (const alert of result.data) {
        const key = String(alert.number);
        if (seen.has(key)) continue;
        seen.add(key);
        alerts.push(alert);
      }
    }
    await observeAlerts(
      ctx,
      "code_scanning_alert",
      alerts,
      actionFor,
      (alert) => `${alert.state}:${alert.updated_at}`,
    );
  },
};
