import { branchProtection } from "./adapters/branch-protection.ts";
import { checkRun } from "./adapters/check-run.ts";
import { checkSuite } from "./adapters/check-suite.ts";
import { pageBuild } from "./adapters/page-build.ts";
import { pullRequest } from "./adapters/pull-request.ts";
import { pullRequestReview } from "./adapters/pull-request-review.ts";
import { pullRequestReviewComment } from "./adapters/pull-request-review-comment.ts";
import { push } from "./adapters/push.ts";
import { createRef, deleteRef } from "./adapters/refs.ts";
import { codeScanningAlert } from "./adapters/code-scanning-alert.ts";
import { commitComment } from "./adapters/commit-comment.ts";
import { dependabotAlert } from "./adapters/dependabot-alert.ts";
import { deployKey } from "./adapters/deploy-key.ts";
import { deployment } from "./adapters/deployment.ts";
import { deploymentProtectionRule } from "./adapters/deployment-protection-rule.ts";
import { deploymentReview } from "./adapters/deployment-review.ts";
import { deploymentStatus } from "./adapters/deployment-status.ts";
import { mergeGroup, workflowDispatch } from "./adapters/dispatch.ts";
import { fork } from "./adapters/fork.ts";
import { discussion } from "./adapters/discussion.ts";
import { discussionComment } from "./adapters/discussion-comment.ts";
import { issueComment } from "./adapters/issue-comment.ts";
import { issues } from "./adapters/issues.ts";
import { label } from "./adapters/label.ts";
import { member } from "./adapters/member.ts";
import { membership } from "./adapters/membership.ts";
import { projectsV2 } from "./adapters/projects-v2.ts";
import { projectsV2Item } from "./adapters/projects-v2-item.ts";
import { team } from "./adapters/team.ts";
import { milestone } from "./adapters/milestone.ts";
import { publicEvent, repository } from "./adapters/repository.ts";
import { repositoryAdvisory } from "./adapters/repository-advisory.ts";
import { repositoryRuleset } from "./adapters/repository-ruleset.ts";
import { securityAndAnalysis } from "./adapters/security-and-analysis.ts";
import { secretScanningAlert } from "./adapters/secret-scanning-alert.ts";
import { vulnerabilityAlert } from "./adapters/vulnerability-alert.ts";
import { release } from "./adapters/release.ts";
import { commitStatus } from "./adapters/status.ts";
import { workflowJob } from "./adapters/workflow-job.ts";
import { workflowRun } from "./adapters/workflow-run.ts";
import type { Adapter, AdapterScope, EventName } from "./types.ts";

export const ADAPTERS: Record<EventName, Adapter> = {
  push,
  create: createRef,
  delete: deleteRef,
  issues,
  issue_comment: issueComment,
  discussion,
  discussion_comment: discussionComment,
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
  deployment_protection_rule: deploymentProtectionRule,
  deployment_review: deploymentReview,
  deploy_key: deployKey,
  repository_ruleset: repositoryRuleset,
  repository_advisory: repositoryAdvisory,
  repository_vulnerability_alert: vulnerabilityAlert,
  security_and_analysis: securityAndAnalysis,
  branch_protection_configuration: branchProtection,
  member,
  team,
  membership,
  projects_v2: projectsV2,
  projects_v2_item: projectsV2Item,
  workflow_run: workflowRun,
  workflow_job: workflowJob,
  check_suite: checkSuite,
  check_run: checkRun,
  pull_request: pullRequest,
  pull_request_review: pullRequestReview,
  pull_request_review_comment: pullRequestReviewComment,
  page_build: pageBuild,
  status: commitStatus,
};

export const IMPLEMENTED_EVENTS = Object.keys(ADAPTERS) as EventName[];

export function adaptersFor(events: EventName[], scope: AdapterScope = "repo"): Adapter[] {
  return events
    .map((event) => ADAPTERS[event])
    .filter((adapter) => (adapter.scope ?? "repo") === scope);
}

export function implementedEvents(scope: AdapterScope): EventName[] {
  return IMPLEMENTED_EVENTS.filter((event) => (ADAPTERS[event].scope ?? "repo") === scope);
}
