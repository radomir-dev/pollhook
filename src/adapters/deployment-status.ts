import type { Adapter } from "../types.ts";
import { observe, repoAndSender } from "./common.ts";

const DEPLOYMENTS = 10;

export const deploymentStatus: Adapter = {
  name: "deployment_status",
  intervalFloorMs: 300_000,
  async poll(ctx) {
    const deployments = await ctx.gh.get<any[]>(
      `/repos/${ctx.repo}/deployments?per_page=${DEPLOYMENTS}`,
      { etagKey: `deployments:statuses:${ctx.repo}` },
    );
    if (deployments.notModified || !deployments.data) return;
    const meta = await repoAndSender(ctx);

    for (const deployment of deployments.data.slice(0, DEPLOYMENTS)) {
      const statuses = await ctx.gh.get<any[]>(
        `/repos/${ctx.repo}/deployments/${deployment.id}/statuses?per_page=20`,
        { etagKey: `deployment-statuses:${deployment.id}` },
      );
      if (statuses.notModified || !statuses.data) continue;
      for (const status of statuses.data) {
        const state = String(status.created_at ?? status.id);
        const { changed } = observe(ctx, "deployment_status", String(status.id), state, status);
        if (!changed) continue;
        ctx.emit(
          "deployment_status",
          "created",
          String(status.id),
          {
            action: "created",
            deployment,
            deployment_status: status,
            repository: meta.repository,
            sender: meta.sender,
          },
          state,
        );
      }
    }
  },
};
