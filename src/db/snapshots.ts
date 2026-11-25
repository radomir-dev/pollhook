import type { DatabaseSync } from "node:sqlite";
import type { Snapshot, SnapshotRow } from "../types.ts";
import { nowIso } from "../util.ts";

export class SnapshotRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  get(repo: string, event: string, key: string): Snapshot | null {
    const row = this.db
      .prepare(
        "select state, data, updated_at from snapshots where repo = ? and event = ? and key = ?",
      )
      .get(repo, event, key) as { state: string; data: string; updated_at: string } | undefined;
    if (!row) return null;
    return { state: row.state, data: JSON.parse(row.data), updatedAt: row.updated_at };
  }

  put(repo: string, event: string, key: string, state: string, data: unknown): void {
    this.db
      .prepare(
        `insert into snapshots (repo, event, key, state, data, updated_at)
         values (?, ?, ?, ?, ?, ?)
         on conflict (repo, event, key) do update
           set state = excluded.state, data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(repo, event, key, state, JSON.stringify(data), nowIso());
  }

  list(repo: string, event: string): SnapshotRow[] {
    const rows = this.db
      .prepare(
        "select repo, event, key, state, data, updated_at from snapshots where repo = ? and event = ? order by updated_at desc, rowid desc",
      )
      .all(repo, event) as {
      repo: string;
      event: string;
      key: string;
      state: string;
      data: string;
      updated_at: string;
    }[];
    return rows.map((row) => ({
      repo: row.repo,
      event: row.event,
      key: row.key,
      state: row.state,
      data: JSON.parse(row.data),
      updatedAt: row.updated_at,
    }));
  }
}
