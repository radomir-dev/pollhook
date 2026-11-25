import { adaptersFor } from "../registry.ts";
import type { AdapterScope, EventName } from "../types.ts";
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

export function statusList(
  statuses: Map<string, RepoStatus>,
  nextDue: Map<string, number>,
  degraded: Map<string, Map<EventName, string>>,
): RepoStatus[] {
  return [...statuses.values()].map((status) => ({
    ...status,
    nextPollAt: nextPollFor(nextDue, status),
    degraded: [...(degraded.get(status.repo) ?? new Map<EventName, string>())].map(
      ([event, reason]) => ({ event, reason }),
    ),
  }));
}

function nextPollFor(nextDue: Map<string, number>, status: RepoStatus): string | null {
  const due = adaptersFor(status.events as EventName[], status.kind)
    .map((adapter) => nextDue.get(`${status.kind}:${status.repo}:${adapter.name}`))
    .filter((value): value is number => typeof value === "number");
  if (due.length === 0) return null;
  return new Date(Math.min(...due)).toISOString();
}

export function isPermanent(error: unknown): boolean {
  return isStatus(error, 403) || isStatus(error, 404);
}

