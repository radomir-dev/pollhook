import type { Adapter } from "../types.ts";
import { observeAlerts } from "./common.ts";

const STATES = ["open", "resolved"] as const;

function actionFor(previous: any, current: any): string {
  if (!previous) return "created";
  if (previous.state !== current.state) {
    return current.state === "open" ? "reopened" : "resolved";
  }
  if (previous.validation_status !== current.validation_status) return "validated";
  return "edited";
}

export const secretScanningAlert: Adapter = {
  name: "secret_scanning_alert",
  intervalFloorMs: 300_000,
  async poll(ctx) {
    const alerts: any[] = [];
    const seen = new Set<string>();
    for (const state of STATES) {
      const result = await ctx.gh.get<any[]>(
        `/repos/${ctx.repo}/secret-scanning/alerts?state=${state}&per_page=100`,
        { etagKey: `secret-scanning:${state}:${ctx.repo}` },
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
      "secret_scanning_alert",
      alerts,
      actionFor,
      (alert) => `${alert.state}:${alert.validation_status ?? ""}:${alert.updated_at}`,
    );
  },
};
