import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Delivery, EventName, Snapshot, SnapshotRow, SnapshotStore } from "../types.ts";
import { CursorRepository } from "./cursors.ts";
import { DeliveryRepository } from "./deliveries.ts";
import { DurationRepository } from "./durations.ts";
import { KEEP_PER_GROUP, SCHEMA } from "./schema.ts";
import { SnapshotRepository } from "./snapshots.ts";

export class StateStore implements SnapshotStore {
  readonly db: DatabaseSync;
  readonly snapshots: SnapshotRepository;
  readonly deliveries: DeliveryRepository;
  readonly durations: DurationRepository;
  private readonly cursors: CursorRepository;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("pragma journal_mode = wal");
    this.db.exec(SCHEMA);
    this.snapshots = new SnapshotRepository(this.db);
    this.deliveries = new DeliveryRepository(this.db);
    this.cursors = new CursorRepository(this.db);
    this.durations = new DurationRepository(this.db);
  }

  getSnapshot(repo: string, event: string, key: string): Snapshot | null {
    return this.snapshots.get(repo, event, key);
  }

  putSnapshot(repo: string, event: string, key: string, state: string, data: unknown): void {
    this.snapshots.put(repo, event, key, state, data);
  }

  listSnapshots(repo: string, event: string): SnapshotRow[] {
    return this.snapshots.list(repo, event);
  }

  getCursor(kind: string): { etag: string | null; value: string | null } | null {
    return this.cursors.get(kind);
  }

  setCursor(kind: string, etag: string | null, value: string | null): void {
    this.cursors.set(kind, etag, value);
  }

  recordDelivery(
    repo: string,
    event: EventName,
    action: string | null,
    key: string,
    state: string,
    payload: Record<string, unknown>,
  ): Delivery | null {
    return this.deliveries.record(repo, event, action, key, state, payload);
  }

  markDelivered(id: string): void {
    this.deliveries.markDelivered(id);
  }

  listDeliveries(limit: number, repo?: string): Delivery[] {
    return this.deliveries.list(limit, repo);
  }

  latestDelivery(repo: string, event: EventName): Delivery | null {
    return this.deliveries.latest(repo, event);
  }

  countDeliveries(): number {
    return this.deliveries.count();
  }

  prune(maxAgeMs: number): void {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    this.db.prepare("delete from snapshots where updated_at < ?").run(cutoff);
    this.db.prepare("delete from deliveries where created_at < ?").run(cutoff);
    const groups = this.db.prepare("select distinct repo, event from snapshots").all() as {
      repo: string;
      event: string;
    }[];
    for (const group of groups) {
      this.db
        .prepare(
          `delete from snapshots where repo = ? and event = ? and rowid not in
           (select rowid from snapshots where repo = ? and event = ? order by updated_at desc limit ?)`,
        )
        .run(group.repo, group.event, group.repo, group.event, KEEP_PER_GROUP);
    }
  }

  close(): void {
    this.db.close();
  }
}
