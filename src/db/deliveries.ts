import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Delivery, EventName } from "../types.ts";
import { nowIso, sha256 } from "../util.ts";

export interface DeliveryRow {
  id: string;
  repo: string;
  event: EventName;
  action: string | null;
  key: string;
  payload: string;
  created_at: string;
  delivered_at: string | null;
}

function toDelivery(row: DeliveryRow): Delivery {
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

export class DeliveryRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  record(
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

  list(limit: number, repo?: string): Delivery[] {
    const rows = (repo
      ? this.db
          .prepare(
            "select id, repo, event, action, key, payload, created_at, delivered_at from deliveries where repo = ? order by rowid desc limit ?",
          )
          .all(repo, limit)
      : this.db
          .prepare(
            "select id, repo, event, action, key, payload, created_at, delivered_at from deliveries order by rowid desc limit ?",
          )
          .all(limit)) as unknown as DeliveryRow[];
    return rows.map(toDelivery);
  }

  latest(repo: string, event: EventName): Delivery | null {
    const row = this.db
      .prepare(
        "select id, repo, event, action, key, payload, created_at, delivered_at from deliveries where repo = ? and event = ? order by rowid desc limit 1",
      )
      .get(repo, event) as DeliveryRow | undefined;
    return row ? toDelivery(row) : null;
  }

  count(): number {
    const row = this.db.prepare("select count(*) as count from deliveries").get() as {
      count: number;
    };
    return row.count;
  }
}
