import type { Adapter, DurationStore, SnapshotStore } from "../types.ts";
import type { EventTuning, Strategy } from "../config/tuning.ts";

const SLOW_INTERVAL_MS = 30_000;
const EARLY_SHARE = 0.5;

export interface ScheduleStore extends SnapshotStore {
  durations: DurationStore;
}

type Target = EventTuning & { intervalMs: number };

export function resolveInterval(config: EventTuning, target: Target, adapter: Adapter): number {
  return (
    target.intervals?.[adapter.name] ??
    config.intervals?.[adapter.name] ??
    target.intervalMs
  );
}

export function resolveStrategy(
  config: EventTuning,
  target: EventTuning,
  adapter: Adapter,
): Strategy {
  return target.strategies?.[adapter.name] ?? config.strategies?.[adapter.name] ?? "fixed";
}

export function delayFor(
  adapter: Adapter,
  intervalMs: number,
  db: ScheduleStore,
  repo: string,
  strategy: Strategy = "fixed",
): number {
  const base = Math.max(adapter.intervalFloorMs, intervalMs);
  if (strategy !== "while-active") return base;
  return runsAreEarly(db, repo) ? Math.max(base, SLOW_INTERVAL_MS) : base;
}

function runsAreEarly(db: ScheduleStore, repo: string): boolean {
  const active = db
    .listSnapshots(repo, "workflow_run")
    .filter((row) => row.data?.status !== "completed");
  if (active.length === 0) return false;
  return active.every((row) => {
    const started = Date.parse(row.data?.run_started_at ?? "");
    const typical = db.durations.typical(repo, String(row.data?.workflow_id ?? ""));
    if (!Number.isFinite(started) || !typical) return false;
    return Date.now() - started < typical.typicalMs * EARLY_SHARE;
  });
}
