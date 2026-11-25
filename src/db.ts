import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Delivery, EventName, Snapshot, SnapshotRow, SnapshotStore } from "./types.ts";
import { nowIso, sha256 } from "./util.ts";

const SCHEMA = `
create table if not exists snapshots (
  repo text not null,
  event text not null,
  key text not null,
  state text not null,
  data text not null,
  updated_at text not null,
  primary key (repo, event, key)
);
create table if not exists cursors (
  kind text primary key,
  etag text,
  value text
);
create table if not exists deliveries (
  id text primary key,
  repo text not null,
  event text not null,
  action text,
  key text not null,
  fingerprint text not null,
  payload text not null,
  created_at text not null,
  delivered_at text,
  unique (repo, event, fingerprint)
);
create index if not exists deliveries_repo_event on deliveries (repo, event);
`;

const KEEP_PER_GROUP = 500;

export class StateStore implements SnapshotStore {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("pragma journal_mode = wal");
    this.db.exec(SCHEMA);
  }

  getSnapshot(repo: string, event: EventName, key: string): Snapshot | null {
    const row = this.db
      .prepare("select state, data, updated_at from snapshots where repo = ? and event = ? and key = ?")
      .get(repo, event, key) as { state: string; data: string; updated_at: string } | undefined;
    if (!row) return null;
    return { state: row.state, data: JSON.parse(row.data), updatedAt: row.updated_at };
  }

  putSnapshot(repo: string, event: EventName, key: string, state: string, data: unknown): void {
    this.db
      .prepare(
        `insert into snapshots (repo, event, key, state, data, updated_at)
         values (?, ?, ?, ?, ?, ?)
         on conflict (repo, event, key) do update
           set state = excluded.state, data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(repo, event, key, state, JSON.stringify(data), nowIso());
  }

  listSnapshots(repo: string, event: EventName): SnapshotRow[] {
    const rows = this.db
      .prepare(
        "select repo, event, key, state, data, updated_at from snapshots where repo = ? and event = ? order by updated_at desc",
      )
      .all(repo, event) as {
      repo: string;
      event: EventName;
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

  getCursor(kind: string): { etag: string | null; value: string | null } | null {
    const row = this.db.prepare("select etag, value from cursors where kind = ?").get(kind) as
      | { etag: string | null; value: string | null }
      | undefined;
    return row ?? null;
  }

  setCursor(kind: string, etag: string | null, value: string | null): void {
    this.db
      .prepare(
        `insert into cursors (kind, etag, value) values (?, ?, ?)
         on conflict (kind) do update set etag = excluded.etag, value = excluded.value`,
      )
      .run(kind, etag, value);
  }

  recordDelivery(
    repo: string,
    event: EventName,
    action: string | null,
    key: string,
    state: string,
    payload: Record<string, unknown>,
  ): Delivery | null {
    const fingerprint = sha256(`${repo}|${event}|${key}|${state}|${action ?? ""}`);
    const id = randomUUID();
    const createdAt = nowIso();
    const info = this.db
      .prepare(
        `insert or ignore into deliveries (id, repo, event, action, key, fingerprint, payload, created_at, delivered_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, null)`,
      )
      .run(id, repo, event, action, key, fingerprint, JSON.stringify(payload), createdAt);
    if (info.changes === 0) return null;
    return { id, repo, event, action, key, payload, createdAt, deliveredAt: null };
  }

  markDelivered(id: string): void {
    this.db.prepare("update deliveries set delivered_at = ? where id = ?").run(nowIso(), id);
  }

  listDeliveries(limit: number, repo?: string): Delivery[] {
    const rows = (
      repo
        ? this.db
            .prepare(
              "select id, repo, event, action, key, payload, created_at, delivered_at from deliveries where repo = ? order by rowid desc limit ?",
            )
            .all(repo, limit)
        : this.db
            .prepare(
              "select id, repo, event, action, key, payload, created_at, delivered_at from deliveries order by rowid desc limit ?",
            )
            .all(limit)
    ) as {
      id: string;
      repo: string;
      event: EventName;
      action: string | null;
      key: string;
      payload: string;
      created_at: string;
      delivered_at: string | null;
    }[];
    return rows.map((row) => ({
      id: row.id,
      repo: row.repo,
      event: row.event,
      action: row.action,
      key: row.key,
      payload: JSON.parse(row.payload),
      createdAt: row.created_at,
      deliveredAt: row.delivered_at,
    }));
  }

  latestDelivery(repo: string, event: EventName): Delivery | null {
    const row = this.db
      .prepare(
        "select id, repo, event, action, key, payload, created_at, delivered_at from deliveries where repo = ? and event = ? order by rowid desc limit 1",
      )
      .get(repo, event) as
      | {
          id: string;
          repo: string;
          event: EventName;
          action: string | null;
          key: string;
          payload: string;
          created_at: string;
          delivered_at: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      repo: row.repo,
      event: row.event,
      action: row.action,
      key: row.key,
      payload: JSON.parse(row.payload),
      createdAt: row.created_at,
      deliveredAt: row.delivered_at,
    };
  }

  countDeliveries(): number {
    const row = this.db.prepare("select count(*) as count from deliveries").get() as { count: number };
    return row.count;
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
