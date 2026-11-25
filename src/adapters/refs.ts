import type { Adapter, AdapterContext } from "../types.ts";
import { repoAndSender } from "./common.ts";

interface Branch {
  name: string;
  commit: { sha: string };
}

interface Tag {
  name: string;
  commit: { sha: string };
}

type RefType = "branch" | "tag";

interface GitRef {
  type: RefType;
  name: string;
  sha: string;
}

const DELETED = "deleted";
const LIMIT = 100;

function refKey(ref: GitRef): string {
  return `${ref.type}:${ref.name}`;
}

function fullRef(ref: GitRef): string {
  return `refs/${ref.type === "branch" ? "heads" : "tags"}/${ref.name}`;
}

async function fetchRefs(ctx: AdapterContext, scope: "create" | "delete"): Promise<GitRef[]> {
  const refs: GitRef[] = [];
  const branches = await ctx.gh.get<Branch[]>(`/repos/${ctx.repo}/branches?per_page=${LIMIT}`, {
    etagKey: `branches:${scope}:${ctx.repo}`,
  });
  if (branches.notModified) refs.push(...stored(ctx, "branch"));
  else for (const branch of branches.data ?? []) refs.push({ type: "branch", name: branch.name, sha: branch.commit.sha });

  const tags = await ctx.gh.get<Tag[]>(`/repos/${ctx.repo}/tags?per_page=${LIMIT}`, {
    etagKey: `tags:${scope}:${ctx.repo}`,
  });
  if (tags.notModified) refs.push(...stored(ctx, "tag"));
  else for (const tag of tags.data ?? []) refs.push({ type: "tag", name: tag.name, sha: tag.commit.sha });
  return refs;
}

function stored(ctx: AdapterContext, type: RefType): GitRef[] {
  return ctx.db
    .listSnapshots(ctx.repo, "refs")
    .filter((row) => row.state !== DELETED && row.data?.type === type)
    .map((row) => ({ type, name: row.data.name as string, sha: row.state }));
}

export const createRef: Adapter = {
  name: "create",
  intervalFloorMs: 30_000,
  async poll(ctx) {
    const refs = await fetchRefs(ctx, "create");
    if (refs.length === 0) return;
    const meta = await repoAndSender(ctx);
    for (const ref of refs) {
      const key = refKey(ref);
      const previous = ctx.db.getSnapshot(ctx.repo, "refs", key);
      if (previous?.state === ref.sha) continue;
      ctx.db.putSnapshot(ctx.repo, "refs", key, ref.sha, { type: ref.type, name: ref.name });
      if (previous && previous.state !== DELETED) continue;
      ctx.emit(
        "create",
        null,
        key,
        {
          ref: fullRef(ref),
          ref_type: ref.type,
          master_branch: (meta.repository as { default_branch: string }).default_branch,
          description: null,
          pusher_type: "user",
          repository: meta.repository,
          sender: meta.sender,
        },
        ref.sha,
      );
    }
  },
};

export const deleteRef: Adapter = {
  name: "delete",
  intervalFloorMs: 30_000,
  async poll(ctx) {
    const refs = await fetchRefs(ctx, "delete");
    const meta = await repoAndSender(ctx);
    const current = new Map(refs.map((ref) => [refKey(ref), ref]));

    for (const row of ctx.db.listSnapshots(ctx.repo, "refs")) {
      if (row.state === DELETED || current.has(row.key)) continue;
      const ref = { type: row.data.type as RefType, name: row.data.name as string, sha: row.state };
      ctx.db.putSnapshot(ctx.repo, "refs", row.key, DELETED, row.data);
      ctx.emit(
        "delete",
        null,
        row.key,
        {
          ref: fullRef(ref),
          ref_type: ref.type,
          pusher_type: "user",
          repository: meta.repository,
          sender: meta.sender,
        },
        `deleted:${row.state}`,
      );
    }

    for (const ref of refs) {
      const previous = ctx.db.getSnapshot(ctx.repo, "refs", refKey(ref));
      if (!previous || previous.state === DELETED) {
        ctx.db.putSnapshot(ctx.repo, "refs", refKey(ref), ref.sha, {
          type: ref.type,
          name: ref.name,
        });
      }
    }
  },
};
