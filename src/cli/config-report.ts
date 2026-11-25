import type { Config } from "../config.ts";
import type { EventTuning } from "../config/tuning.ts";
import type { Adapter } from "../types.ts";
import { adaptersFor } from "../registry.ts";
import { resolveInterval, resolveStrategy } from "../poller/schedule.ts";

export function configReport(config: Config): string[] {
  const lines: string[] = [];
  for (const repo of config.repos) {
    lines.push(repo.repo, ...rows(config, repo, adaptersFor(repo.events, "repo")));
  }
  for (const org of config.orgs) {
    lines.push(`${org.org} (organisation)`, ...rows(config, org, adaptersFor(org.events, "org")));
  }
  return lines;
}

function rows(
  config: Config,
  target: EventTuning & { intervalMs: number },
  adapters: Adapter[],
): string[] {
  return adapters.map((adapter) => {
    const seconds =
      Math.max(adapter.intervalFloorMs, resolveInterval(config, target, adapter)) / 1000;
    const strategy = resolveStrategy(config, target, adapter);
    return `  ${adapter.name.padEnd(32)} every ${String(seconds).padStart(4)}s  ${strategy}`;
  });
}
