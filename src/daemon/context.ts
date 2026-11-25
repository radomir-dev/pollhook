import type { StateStore } from "../db.ts";
import type { Delivery } from "../types.ts";

export interface DaemonContext {
  db: StateStore;
  listeners: Set<(delivery: Delivery) => void>;
  status(): Record<string, unknown>;
  poke(repo?: string): boolean;
  waiters: { count: number };
}
