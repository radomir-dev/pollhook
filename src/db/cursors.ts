import type { DatabaseSync } from "node:sqlite";

export class CursorRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  get(kind: string): { etag: string | null; value: string | null } | null {
    const row = this.db.prepare("select etag, value from cursors where kind = ?").get(kind) as
      | { etag: string | null; value: string | null }
      | undefined;
    return row ?? null;
  }

  set(kind: string, etag: string | null, value: string | null): void {
    this.db
      .prepare(
        `insert into cursors (kind, etag, value) values (?, ?, ?)
         on conflict (kind) do update set etag = excluded.etag, value = excluded.value`,
      )
      .run(kind, etag, value);
  }
}
