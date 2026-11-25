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
  | "workflow_run"
  | "check_suite"
  | "check_run"
  | "pull_request"
  | "pull_request_review"
  | "page_build"
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
  get<T>(path: string, opts?: { etagKey?: string }): Promise<GetResult<T>>;
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
  refs: string[];
  db: SnapshotStore;
  gh: GithubClient;
  emit: AdapterEmit;
}

export interface Adapter {
  name: EventName;
  intervalFloorMs: number;
  poll(ctx: AdapterContext): Promise<void>;
}
