export type AdapterScope = "repo" | "org";

export type EventName =
  | "push"
  | "create"
  | "delete"
  | "issues"
  | "issue_comment"
  | "release"
  | "label"
  | "milestone"
  | "repository"
  | "public"
  | "fork"
  | "commit_comment"
  | "workflow_dispatch"
  | "merge_group"
  | "dependabot_alert"
  | "code_scanning_alert"
  | "secret_scanning_alert"
  | "deployment"
  | "deployment_status"
  | "deployment_protection_rule"
  | "deploy_key"
  | "repository_ruleset"
  | "repository_advisory"
  | "repository_vulnerability_alert"
  | "security_and_analysis"
  | "branch_protection_configuration"
  | "member"
  | "team"
  | "membership"
  | "workflow_run"
  | "check_suite"
  | "check_run"
  | "pull_request"
  | "pull_request_review"
  | "pull_request_review_comment"
  | "page_build"
  | "workflow_job"
  | "status";

export interface RepoInfo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string; id: number };
  private: boolean;
  html_url: string;
  default_branch: string;
  visibility?: string;
}

export interface GetResult<T> {
  notModified: boolean;
  data: T | undefined;
}

export interface GithubClient {
  /** How much to stretch poll intervals under rate-limit pressure; 1 is normal. */
  pressure?(): number;
  get<T>(path: string, opts?: { etagKey?: string }): Promise<GetResult<T>>;
  probe(path: string): Promise<boolean>;
  repoInfo(repo: string): Promise<RepoInfo>;
  sender(): Promise<Record<string, unknown>>;
}

export interface Snapshot {
  state: string;
  data: any;
  updatedAt: string;
}

export interface SnapshotRow extends Snapshot {
  repo: string;
  event: string;
  key: string;
}

export interface SnapshotStore {
  getSnapshot(repo: string, event: string, key: string): Snapshot | null;
  putSnapshot(repo: string, event: string, key: string, state: string, data: unknown): void;
  listSnapshots(repo: string, event: string): SnapshotRow[];
}

export interface DurationStats {
  typicalMs: number;
  samples: number;
}

export interface DurationStore {
  record(repo: string, runId: string, workflowId: string, durationMs: number): void;
  typical(repo: string, workflowId: string): DurationStats | null;
}

export interface Delivery {
  id: string;
  repo: string;
  event: EventName;
  action: string | null;
  key: string;
  payload: Record<string, unknown>;
  createdAt: string;
  deliveredAt: string | null;
}

export type Emit = (
  repo: string,
  event: EventName,
  action: string | null,
  key: string,
  payload: Record<string, unknown>,
  state: string,
) => void;

export type AdapterEmit = (
  event: EventName,
  action: string | null,
  key: string,
  payload: Record<string, unknown>,
  state: string,
) => void;

export interface AdapterContext {
  repo: string;
  org?: string | null;
  refs: string[];
  db: SnapshotStore;
  durations: DurationStore;
  gh: GithubClient;
  emit: AdapterEmit;
}

export interface Adapter {
  name: EventName;
  scope?: AdapterScope;
  intervalFloorMs: number;
  poll(ctx: AdapterContext): Promise<void>;
}
