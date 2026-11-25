import type { Adapter } from "../types.ts";
import { sha256 } from "../util.ts";
import { observe, repoAndSender } from "./common.ts";

const DELETED = "deleted";

function stateFor(ruleset: any): string {
  return sha256(JSON.stringify(ruleset));
}

export const repositoryRuleset: Adapter = {
  name: "repository_ruleset",
  intervalFloorMs: 300_000,
  async poll(ctx) {
    const result = await ctx.gh.get<any[]>(`/repos/${ctx.repo}/rulesets?per_page=100`, {
      etagKey: `rulesets:${ctx.repo}`,
    });
    if (result.notModified || !result.data) return;
    const meta = await repoAndSender(ctx);
    const current = new Set(result.data.map((ruleset) => String(ruleset.id)));

    for (const ruleset of result.data) {
      const state = stateFor(ruleset);
      const { changed, prev } = observe(
        ctx,
        "repository_ruleset",
        String(ruleset.id),
        state,
        ruleset,
      );
      if (!changed) continue;
      const action = prev && prev.state !== DELETED ? "edited" : "created";
      ctx.emit(
        "repository_ruleset",
        action,
        String(ruleset.id),
        { action, ruleset, repository: meta.repository, sender: meta.sender },
        `${state}:${action}`,
      );
    }

    for (const row of ctx.db.listSnapshots(ctx.repo, "repository_ruleset")) {
      if (row.state === DELETED || current.has(row.key)) continue;
      ctx.db.putSnapshot(ctx.repo, "repository_ruleset", row.key, DELETED, row.data);
      ctx.emit(
        "repository_ruleset",
        "deleted",
        row.key,
        { action: "deleted", ruleset: row.data, repository: meta.repository, sender: meta.sender },
        `deleted:${row.state}`,
      );
    }
  },
};
