import type { AdapterScope, EventName, SnapshotStore } from "../types.ts";
import { isStatus } from "../util.ts";

export interface RepoStatus {
  repo: string;
  kind: AdapterScope;
  events: string[];
  lastPollAt: string | null;
  lastEventAt: string | null;
  lastError: string | null;
  nextPollAt: string | null;
  degraded: Array<{ event: string; reason: string }>;
}

export const DEGRADED_MS = 60 * 60 * 1000;

export function statusFor(kind: AdapterScope, name: string, events: EventName[]): RepoStatus {
  return {
    repo: name,
    kind,
    events: [...events],
    lastPollAt: null,
    lastEventAt: null,
    lastError: null,
    nextPollAt: null,
    degraded: [],
  };
}

export function isPermanent(error: unknown): boolean {
  return isStatus(error, 403) || isStatus(error, 404);
}

