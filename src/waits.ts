import type { StateStore } from "./db.ts";
import type { EventName } from "./types.ts";
import { pick } from "./util.ts";

export type WaitRequest =
  | { kind: "run"; repo: string; id: string }
  | { kind: "checks"; repo: string; pr: number; initialHead?: string }
  | { kind: "pr"; repo: string; pr: number; until: "merged" | "closed" | "reviewed" | "conflict" }
  | { kind: "pages"; repo: string; sha: string }
  | { kind: "event"; repo?: string; event: EventName; match: Record<string, string> };

export interface WaitOutcome {
  exitCode: number;
  body: Record<string, unknown>;
}

const FAILED = new Set(["failure", "timed_out", "cancelled", "action_required", "stale"]);
const SUCCESS = new Set(["success", "neutral", "skipped"]);

export function resolveWait(db: StateStore, request: WaitRequest): WaitOutcome | null {
  switch (request.kind) {
    case "run":
      return resolveRun(db, request);
    case "checks":
      return resolveChecks(db, request);
    case "pr":
      return resolvePullRequest(db, request);
    case "pages":
      return resolvePages(db, request);
    case "event":
      return resolveEvent(db, request);
  }
}

function resolveRun(
  db: StateStore,
  request: Extract<WaitRequest, { kind: "run" }>,
): WaitOutcome | null {
  const snapshot = db.getSnapshot(request.repo, "workflow_run", request.id);
  if (!snapshot) return null;
  const run = snapshot.data;
  if (run?.status !== "completed") return null;
  return {
    exitCode: SUCCESS.has(run.conclusion) ? 0 : 1,
    body: {
      name: run.name,
      conclusion: run.conclusion,
      head_sha: run.head_sha,
      url: run.html_url,
    },
  };
}

function resolveChecks(
  db: StateStore,
  request: Extract<WaitRequest, { kind: "checks" }>,
): WaitOutcome | null {
  const pull = db.getSnapshot(request.repo, "pull_request", String(request.pr));
  const head = pull?.data?.head?.sha;
  if (!head) return null;
  const runs = db
    .listSnapshots(request.repo, "check_run")
    .filter((row) => row.data?.head_sha === head);
  if (runs.length === 0) return null;
  if (runs.some((row) => row.data?.status !== "completed")) return null;
  const failing = runs
    .filter((row) => FAILED.has(row.data?.conclusion))
    .map((row) => row.data?.name ?? row.key);
  return {
    exitCode: failing.length > 0 ? 1 : 0,
    body: {
      head_sha: head,
      total: runs.length,
      failing,
      restarted: Boolean(request.initialHead && request.initialHead !== head),
    },
  };
}

function resolvePullRequest(
  db: StateStore,
  request: Extract<WaitRequest, { kind: "pr" }>,
): WaitOutcome | null {
  const snapshot = db.getSnapshot(request.repo, "pull_request", String(request.pr));
  if (!snapshot) return null;
  const pull = snapshot.data;
  const base = {
    number: request.pr,
    state: pull?.state,
    merged: pull?.merged,
    mergeable: pull?.mergeable,
  };
  if (request.until === "merged") {
    if (pull?.merged === true) return { exitCode: 0, body: base };
    if (pull?.state === "closed") return { exitCode: 1, body: base };
    return null;
  }
  if (request.until === "closed") {
    return pull?.state === "closed" ? { exitCode: 0, body: base } : null;
  }
  if (request.until === "reviewed") {
    const reviews = db
      .listSnapshots(request.repo, "pull_request_review")
      .filter((row) => row.key.startsWith(`${request.pr}:`) && row.data?.state !== "DISMISSED");
    if (reviews.length === 0) return null;
    return { exitCode: 0, body: { ...base, reviews: reviews.length } };
  }
  if (pull?.mergeable === false) {
    return { exitCode: 0, body: { ...base, mergeable_state: pull?.mergeable_state } };
  }
  return null;
}

function resolvePages(
  db: StateStore,
  request: Extract<WaitRequest, { kind: "pages" }>,
): WaitOutcome | null {
  const builds = db
    .listSnapshots(request.repo, "page_build")
    .filter((row) => row.data?.build?.commit === request.sha);
  const latest = builds[0];
  if (!latest) return null;
  const status = latest.data?.build?.status;
  if (status !== "built" && status !== "errored") return null;
  return {
    exitCode: status === "built" ? 0 : 1,
    body: { status, commit: request.sha, url: latest.data?.build?.url },
  };
}

function resolveEvent(
  db: StateStore,
  request: Extract<WaitRequest, { kind: "event" }>,
): WaitOutcome | null {
  const recent = db.listDeliveries(50, request.repo);
  const match = recent.find(
    (delivery) =>
      delivery.event === request.event &&
      Object.entries(request.match ?? {}).every(
        ([path, expected]) => String(pick(delivery.payload, path)) === expected,
      ),
  );
  return match ? { exitCode: 0, body: match.payload } : null;
}
