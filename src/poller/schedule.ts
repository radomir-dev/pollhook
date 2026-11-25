import type { Adapter, DurationStore, SnapshotStore } from "../types.ts";

const SLOW_INTERVAL_MS = 30_000;
const EARLY_SHARE = 0.5;

export interface ScheduleStore extends SnapshotStore {
  durations: DurationStore;
}

export function delayFor(
  adapter: Adapter,
  intervalMs: number,
  db: ScheduleStore,
  repo: string,
): number {
  const base = Math.max(adapter.intervalFloorMs, intervalMs);
  if (adapter.name !== "workflow_run") return base;
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
