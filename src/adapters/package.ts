import { PACKAGE_TYPES } from "../types.ts";
import type { Adapter, AdapterContext, EventName, PackageType } from "../types.ts";
import { diffList, observe, orgAndSender, PAGE_SIZE, type Change } from "./common.ts";

const ACTIONS = { created: "published", edited: "updated", deleted: "deleted" } as const;

interface Meta {
  organization: { login: string };
  sender: Record<string, unknown>;
}

function typesFor(ctx: AdapterContext): readonly PackageType[] {
  return ctx.packageTypes ?? PACKAGE_TYPES;
}

function packageState(item: any): string {
  return `${item.id}:${item.version_count}:${item.visibility}`;
}

function versionState(version: any): string {
  const tags: string[] = version.metadata?.container?.tags ?? [];
  return `${version.id}:${version.updated_at}:${[...tags].sort().join(",")}`;
}

async function pollList(
  ctx: AdapterContext,
  type: PackageType,
  event: EventName,
  etag: string,
  prefix: string,
  onChange: (change: Change, item: any, stamp: string) => void,
): Promise<void> {
  const result = await ctx.gh.get<any[]>(
    `/orgs/${ctx.org}/packages?package_type=${type}&per_page=${PAGE_SIZE}`,
    { etagKey: `${etag}:${ctx.org}:${type}` },
  );
  if (result.notModified || !result.data) return;
  const entries = result.data.map((item) => ({
    key: `${prefix}${item.name}`,
    state: packageState(item),
    item,
  }));
  diffList(ctx, event, entries, result.data.length < PAGE_SIZE, onChange, prefix);
}

async function pollVersions(
  ctx: AdapterContext,
  type: PackageType,
  pkg: any,
  meta: Meta,
): Promise<void> {
  const result = await ctx.gh.get<any[]>(
    `/orgs/${ctx.org}/packages/${type}/${encodeURIComponent(pkg.name)}/versions?per_page=${PAGE_SIZE}`,
    { etagKey: `package-versions:${ctx.org}:${type}:${pkg.name}` },
  );
  if (result.notModified || !result.data) return;
  for (const version of result.data) {
    const key = `v:${type}:${pkg.name}:${version.id}`;
    const state = versionState(version);
    const { changed, prev } = observe(ctx, "registry_package", key, state, version);
    if (!changed) continue;
    const action = prev ? "updated" : "published";
    ctx.emit(
      "registry_package",
      action,
      key,
      { action, registry_package: pkg, package_version: version, ...meta },
      `${state}:${action}`,
    );
  }
}

export const packageEvent: Adapter = {
  name: "package",
  scope: "org",
  intervalFloorMs: 300_000,
  async poll(ctx) {
    if (!ctx.org) return;
    const meta = await orgAndSender(ctx);
    for (const type of typesFor(ctx)) {
      const prefix = `${type}:`;
      await pollList(ctx, type, "package", "packages", prefix, (change, item, stamp) => {
        const action = ACTIONS[change];
        ctx.emit(
          "package",
          action,
          `${prefix}${item.name}`,
          { action, package: item, ...meta },
          `${stamp}:${action}`,
        );
      });
    }
  },
};

export const registryPackage: Adapter = {
  name: "registry_package",
  scope: "org",
  intervalFloorMs: 300_000,
  async poll(ctx) {
    if (!ctx.org) return;
    const meta = await orgAndSender(ctx);
    for (const type of typesFor(ctx)) {
      const changed: any[] = [];
      await pollList(
        ctx,
        type,
        "registry_package",
        "packages:registry",
        `p:${type}:`,
        (change, item) => {
          if (change !== "deleted") changed.push(item);
        },
      );
      for (const item of changed) await pollVersions(ctx, type, item, meta);
    }
  },
};
