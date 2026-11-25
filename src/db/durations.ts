import type { DatabaseSync } from "node:sqlite";
import type { DurationStats } from "../types.ts";
import { nowIso } from "../util.ts";

const KEEP_PER_WORKFLOW = 20;
const MIN_SAMPLES = 3;

export class DurationRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  record(repo: string, runId: string, workflowId: string, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    this.db
      .prepare(
        `insert or ignore into run_durations (repo, run_id, workflow_id, duration_ms, recorded_at)
         values (?, ?, ?, ?, ?)`,
      )
      .run(repo, runId, workflowId, Math.round(durationMs), nowIso());
    this.db
      .prepare(
        `delete from run_durations where repo = ? and workflow_id = ? and rowid not in
         (select rowid from run_durations where repo = ? and workflow_id = ?
          order by rowid desc limit ?)`,
      )
      .run(repo, workflowId, repo, workflowId, KEEP_PER_WORKFLOW);
  }

  typical(repo: string, workflowId: string): DurationStats | null {
    const rows = this.db
      .prepare(
        `select duration_ms from run_durations where repo = ? and workflow_id = ?
         order by rowid desc limit ?`,
      )
      .all(repo, workflowId, KEEP_PER_WORKFLOW) as { duration_ms: number }[];
    if (rows.length < MIN_SAMPLES) return null;
    const values = rows.map((row) => row.duration_ms).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    const median =
      values.length % 2 === 1
        ? values[middle]!
        : Math.round((values[middle - 1]! + values[middle]!) / 2);
    return { typicalMs: median, samples: rows.length };
  }
}
