import type { Adapter, AdapterContext } from "../types.ts";
import { sha256 } from "../util.ts";
import { observe, repoAndSender } from "./common.ts";

interface Environments {
  total_count: number;
  environments: Array<{ name: string }>;
}

interface Rule {
  id: number;
  node_id?: string;
  enabled?: boolean;
  app?: { slug?: string; id?: number };
}

interface RuleList {
  custom_deployment_protection_rules: Rule[];
}

const LIMIT = 100;

function ruleKey(environment: string, id: number): string {
  return `${environment}:${id}`;
}

function ruleState(rule: Rule): string {
  return sha256(
    JSON.stringify({ enabled: rule.enabled, app: rule.app?.slug ?? rule.app?.id ?? null }),
  );
}

async function fetchRules(
  ctx: AdapterContext,
): Promise<Array<{ environment: string; rule: Rule }>> {
  const envResult = await ctx.gh.get<Environments>(
    `/repos/${ctx.repo}/environments?per_page=${LIMIT}`,
    { etagKey: `environments:${ctx.repo}` },
  );
  const rules: Array<{ environment: string; rule: Rule }> = [];
  for (const environment of envResult.data?.environments ?? []) {
    const result = await ctx.gh.get<RuleList>(
      `/repos/${ctx.repo}/environments/${encodeURIComponent(environment.name)}/deployment_protection_rules`,
      { etagKey: `protection-rules:${ctx.repo}:${environment.name}` },
    );
    for (const rule of result.data?.custom_deployment_protection_rules ?? []) {
      rules.push({ environment: environment.name, rule });
    }
  }
  return rules;
}

export const deploymentProtectionRule: Adapter = {
  name: "deployment_protection_rule",
  intervalFloorMs: 300_000,
  async poll(ctx) {
    const rules = await fetchRules(ctx);
    const meta = await repoAndSender(ctx);
    const seen = new Set<string>();
    for (const { environment, rule } of rules) {
      const key = ruleKey(environment, rule.id);
      seen.add(key);
      const state = ruleState(rule);
      const { changed, prev } = observe(ctx, "deployment_protection_rule", key, state, {
        environment,
        rule,
      });
      if (!changed) continue;
      const action = prev && prev.state !== "deleted" ? "edited" : "created";
      ctx.emit(
        "deployment_protection_rule",
        action,
        key,
        {
          action,
          environment,
          deployment_protection_rule: rule,
          repository: meta.repository,
          sender: meta.sender,
        },
        state,
      );
    }
    for (const row of ctx.db.listSnapshots(ctx.repo, "deployment_protection_rule")) {
      if (seen.has(row.key) || row.state === "deleted") continue;
      ctx.db.putSnapshot(ctx.repo, "deployment_protection_rule", row.key, "deleted", row.data);
      ctx.emit(
        "deployment_protection_rule",
        "deleted",
        row.key,
        {
          action: "deleted",
          environment: row.data?.environment ?? null,
          deployment_protection_rule: row.data?.rule ?? null,
          repository: meta.repository,
          sender: meta.sender,
        },
        "deleted",
      );
    }
  },
};
