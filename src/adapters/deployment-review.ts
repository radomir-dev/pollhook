import type { Adapter, AdapterContext } from "../types.ts";
import { observe, repoAndSender } from "./common.ts";

const MAX_ACTIVE_RUNS = 5;

interface PendingDeployments {
  total_count?: number;
  pending_deployments?: any[];
}

async function fetchPending(
  ctx: AdapterContext,
  runId: string,
): Promise<any[]> {
  const result = await ctx.gh.get<PendingDeployments | any[]>(
    `/repos/${ctx.repo}/actions/runs/${runId}/pending_deployments`,
    { etagKey: `pending-deployments:${ctx.repo}:${runId}` },
  );
  const data = result.data;
  if (!data) return [];
  return Array.isArray(data) ? data : (data.pending_deployments ?? []);
}

function pendingKey(runId: string, deployment: any): string {
  const environment = deployment.environment?.id ?? deployment.environment?.name ?? "unknown";
  return `${runId}:${environment}`;
}

export const deploymentReview: Adapter = {
  name: "deployment_review",
  intervalFloorMs: 300_000,
  async poll(ctx) {
    const active = ctx.db
      .listSnapshots(ctx.repo, "workflow_run")
      .filter((row) => row.data?.status !== "completed")
      .slice(0, MAX_ACTIVE_RUNS);
    if (active.length === 0) return;
    const meta = await repoAndSender(ctx);
    for (const row of active) {
      const runId = String(row.data?.id ?? row.key);
      const pending = await fetchPending(ctx, runId);
      for (const deployment of pending) {
        const key = pendingKey(runId, deployment);
        const state = `${deployment.state ?? "pending"}:${deployment.comment ?? ""}`;
        const { changed } = observe(ctx, "deployment_review", key, state, {
          run: row.data,
          deployment,
        });
        if (!changed) continue;
        ctx.emit(
          "deployment_review",
          "requested",
          key,
          {
            action: "requested",
            environment: deployment.environment ?? null,
            workflow_run: row.data ?? { id: runId },
            pending_deployment: deployment,
            repository: meta.repository,
            sender: meta.sender,
          },
          state,
        );
      }
    }
  },
};
