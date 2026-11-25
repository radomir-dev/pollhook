import { checkRun } from "./adapters/check-run.ts";
import { checkSuite } from "./adapters/check-suite.ts";
import { pageBuild } from "./adapters/page-build.ts";
import { pullRequest } from "./adapters/pull-request.ts";
import { pullRequestReview } from "./adapters/pull-request-review.ts";
import { push } from "./adapters/push.ts";
import { createRef, deleteRef } from "./adapters/refs.ts";
import { codeScanningAlert } from "./adapters/code-scanning-alert.ts";
import { commitComment } from "./adapters/commit-comment.ts";
import { dependabotAlert } from "./adapters/dependabot-alert.ts";
import { deployKey } from "./adapters/deploy-key.ts";
import { deployment } from "./adapters/deployment.ts";
import { deploymentStatus } from "./adapters/deployment-status.ts";
import { mergeGroup, workflowDispatch } from "./adapters/dispatch.ts";
import { fork } from "./adapters/fork.ts";
import { issueComment } from "./adapters/issue-comment.ts";
import { issues } from "./adapters/issues.ts";
import { label } from "./adapters/label.ts";
import { milestone } from "./adapters/milestone.ts";
import { publicEvent, repository } from "./adapters/repository.ts";
import { repositoryRuleset } from "./adapters/repository-ruleset.ts";
import { secretScanningAlert } from "./adapters/secret-scanning-alert.ts";
import { release } from "./adapters/release.ts";
import { commitStatus } from "./adapters/status.ts";
import { workflowRun } from "./adapters/workflow-run.ts";
import type { Adapter, EventName } from "./types.ts";

export const ADAPTERS: Record<EventName, Adapter> = {
  push,
  create: createRef,
  delete: deleteRef,
  issues,
  issue_comment: issueComment,
  release,
  label,
  milestone,
  repository,
  public: publicEvent,
  fork,
  commit_comment: commitComment,
  workflow_dispatch: workflowDispatch,
  merge_group: mergeGroup,
  dependabot_alert: dependabotAlert,
  code_scanning_alert: codeScanningAlert,
  secret_scanning_alert: secretScanningAlert,
  deployment,
  deployment_status: deploymentStatus,
  deploy_key: deployKey,
  repository_ruleset: repositoryRuleset,
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
