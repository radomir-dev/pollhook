import { checkRun } from "./adapters/check-run.ts";
import { checkSuite } from "./adapters/check-suite.ts";
import { pageBuild } from "./adapters/page-build.ts";
import { pullRequest } from "./adapters/pull-request.ts";
import { pullRequestReview } from "./adapters/pull-request-review.ts";
import { push } from "./adapters/push.ts";
import { commitStatus } from "./adapters/status.ts";
import { workflowRun } from "./adapters/workflow-run.ts";
import type { Adapter, EventName } from "./types.ts";

export const ADAPTERS: Record<EventName, Adapter> = {
  push,
  workflow_run: workflowRun,
  check_suite: checkSuite,
  check_run: checkRun,
  pull_request: pullRequest,
  pull_request_review: pullRequestReview,
  page_build: pageBuild,
  status: commitStatus,
};

export const IMPLEMENTED_EVENTS = Object.keys(ADAPTERS) as EventName[];

export function adaptersFor(events: EventName[]): Adapter[] {
  return events.map((event) => ADAPTERS[event]);
}
