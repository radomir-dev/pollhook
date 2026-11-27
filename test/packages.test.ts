import assert from "node:assert/strict";
import { test } from "vitest";
import { packageEvent, registryPackage } from "../src/adapters/package.ts";
import { StateStore } from "../src/db.ts";
import type { Adapter, PackageType } from "../src/types.ts";
import { PACKAGE_TYPES } from "../src/types.ts";
import { emitFor, FakeGitHub } from "./helpers.ts";

const listPath = (type: PackageType): string =>
  `/orgs/acme/packages?package_type=${type}&per_page=100`;
const versionsPath = (type: PackageType, name: string): string =>
  `/orgs/acme/packages/${type}/${encodeURIComponent(name)}/versions?per_page=100`;

const pkg = (name: string, extra: Record<string, unknown> = {}) => ({
  id: 1,
  name,
  package_type: "npm",
  version_count: 1,
  visibility: "public",
  ...extra,
});

const version = (id: number, tags: string[]) => ({
  id,
  name: "app",
  created_at: "2026-11-27T00:00:00Z",
  updated_at: "2026-11-27T00:00:00Z",
  metadata: { package_type: "container", container: { tags } },
});

function setup(adapter: Adapter, responses: Record<string, unknown>, packageTypes?: PackageType[]) {
  const db = new StateStore(":memory:");
  const gh = new FakeGitHub(responses);
  const state = emitFor(db, "acme");
  const poll = () =>
    adapter.poll({
      repo: "acme",
      org: "acme",
      packageTypes,
      refs: [],
      db,
      durations: db.durations,
      gh,
      emit: state.emit,
    });
  return { db, gh, poll, state };
}

test("package: published, updated and deleted", async () => {
  const { db, gh, poll, state } = setup(packageEvent, { [listPath("npm")]: [] }, ["npm"]);
  await poll();
  gh.respond(listPath("npm"), [pkg("left-pad")]);
  await poll();
  gh.respond(listPath("npm"), [pkg("left-pad", { version_count: 2 })]);
  await poll();
  gh.respond(listPath("npm"), []);
  await poll();

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["published", "updated", "deleted"],
  );
  assert.equal(state.deliveries[0]!.key, "npm:left-pad");
  assert.equal((state.deliveries[1]!.payload.package as any).version_count, 2);
  assert.equal((state.deliveries[1]!.payload.organization as any).login, "acme");
  db.close();
});

test("package: the same name under two types is two packages", async () => {
  const responses = {
    [listPath("npm")]: [pkg("app")],
    [listPath("container")]: [pkg("app", { package_type: "container" })],
  };
  const { db, gh, poll, state } = setup(packageEvent, responses, ["npm", "container"]);
  await poll();
  gh.respond(listPath("npm"), []);
  await poll();

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["published", "published", "deleted"],
  );
  assert.equal(state.deliveries[2]!.key, "npm:app");
  db.close();
});

test("package: all six types are polled when the config does not narrow them", async () => {
  const responses = Object.fromEntries(
    PACKAGE_TYPES.map((type) => [listPath(type), [pkg(type, { package_type: type })]]),
  );
  const { db, poll, state } = setup(packageEvent, responses);
  await poll();

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.key),
    PACKAGE_TYPES.map((type) => `${type}:${type}`),
  );
  db.close();
});

test("package: narrowing the types leaves the other five unrequested", async () => {
  const responses = {
    [listPath("container")]: [pkg("image", { package_type: "container" })],
  };
  const { db, poll, state } = setup(packageEvent, responses, ["container"]);
  await poll();

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.key),
    ["container:image"],
  );
  db.close();
});

test("package: a full page suppresses removal detection", async () => {
  const page = Array.from({ length: 100 }, (_, index) => pkg(`p${index}`, { id: index + 1 }));
  const { db, gh, poll, state } = setup(packageEvent, { [listPath("npm")]: page }, ["npm"]);
  await poll();
  gh.respond(listPath("npm"), [...page.slice(0, 99), pkg("new", { id: 101 })]);
  await poll();

  assert.ok(!state.deliveries.some((delivery) => delivery.action === "deleted"));
  assert.equal(state.deliveries.at(-1)!.key, "npm:new");
  db.close();
});

test("registry_package: versions are read only when the package state moved", async () => {
  const image = (extra: Record<string, unknown> = {}) =>
    pkg("app", { id: 9, package_type: "container", ...extra });
  const { db, gh, poll, state } = setup(
    registryPackage,
    {
      [listPath("container")]: [image()],
      [versionsPath("container", "app")]: [version(1, ["latest"])],
    },
    ["container"],
  );
  await poll();

  gh.respond(listPath("container"), [image({ version_count: 2 })]);
  gh.respond(versionsPath("container", "app"), [
    version(1, ["latest"]),
    version(2, ["latest", "1.0"]),
  ]);
  await poll();

  gh.respond(versionsPath("container", "app"), [
    version(1, ["latest"]),
    version(2, ["latest", "1.0", "edge"]),
  ]);
  await poll();

  gh.respond(listPath("container"), [image({ version_count: 2, visibility: "private" })]);
  await poll();

  assert.deepEqual(
    state.deliveries.map((delivery) => delivery.action),
    ["published", "published", "updated"],
  );
  assert.equal((state.deliveries[1]!.payload.package_version as any).id, 2);
  assert.equal((state.deliveries[2]!.payload.registry_package as any).package_type, "container");
  assert.deepEqual((state.deliveries[2]!.payload.package_version as any).metadata.container.tags, [
    "latest",
    "1.0",
    "edge",
  ]);
  db.close();
});
