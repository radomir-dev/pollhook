import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import type { StateStore } from "../src/db.ts";
import type { Delivery, Emit, GetResult, GithubClient, RepoInfo } from "../src/types.ts";

export class FakeGitHub implements GithubClient {
  responses: Record<string, unknown>;

  constructor(responses: Record<string, unknown>) {
    this.responses = responses;
  }

  async get<T>(path: string): Promise<GetResult<T>> {
    if (!(path in this.responses)) throw new Error(`404 ${path}`);
    const value = this.responses[path];
    if (value === null) return { notModified: true, data: undefined };
    return { notModified: false, data: value as T };
  }

  async repoInfo(repo: string): Promise<RepoInfo> {
    const [owner, name] = repo.split("/");
    return {
      id: 1,
      name: name ?? repo,
      full_name: repo,
      owner: { login: owner ?? "acme", id: 2 },
      private: true,
      html_url: `https://github.com/${repo}`,
      default_branch: "main",
    };
  }

  async sender(): Promise<Record<string, unknown>> {
    return { login: "tiriana", id: 3 };
  }

  respond(path: string, value: unknown): void {
    this.responses[path] = value;
  }
}

export function emitInto(db: StateStore): { emit: Emit; deliveries: Delivery[] } {
  const deliveries: Delivery[] = [];
  const emit: Emit = (repo, event, action, key, payload, state) => {
    const delivery = db.recordDelivery(repo, event, action, key, state, payload);
    if (delivery) deliveries.push(delivery);
  };
  return { emit, deliveries };
}

export function tempStateDir(): string {
  return mkdtempSync(join(tmpdir(), "pollhook-test-"));
}

export function rpcTo(socketPath: string, message: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify(message)}\n`));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const index = buffer.indexOf("\n");
      if (index < 0) return;
      const response = JSON.parse(buffer.slice(0, index));
      socket.destroy();
      resolve(response);
    });
    socket.once("error", reject);
  });
}
