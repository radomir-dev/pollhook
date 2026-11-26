import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { parseConfig } from "../src/config.ts";
import { MIN_INTERVAL_SECONDS } from "../src/config/help.ts";
import { configSchema, findUnknownKeys } from "../src/config/schema.ts";
import { implementedEvents } from "../src/registry.ts";

const root = join(import.meta.dirname, "..");

test("the committed schema is exactly what the code generates", () => {
  const committed = readFileSync(join(root, "pollhook.schema.json"), "utf8");

  assert.equal(committed, `${JSON.stringify(configSchema(), null, 2)}\n`);
});

test("the schema offers exactly the events each target type supports", () => {
  const schema = configSchema().properties;

  assert.deepEqual(schema.repos.items.properties.events.items.enum, implementedEvents("repo"));
  assert.deepEqual(schema.orgs.items.properties.events.items.enum, implementedEvents("org"));
  assert.deepEqual(Object.keys(schema.intervals.properties), implementedEvents("repo"));
});

test("the schema and the parser agree on the smallest interval", () => {
  const schema = configSchema().properties;

  assert.equal(schema.repos.items.properties.intervalSeconds.minimum, MIN_INTERVAL_SECONDS);
  assert.equal(schema.intervals.properties.workflow_run.minimum, MIN_INTERVAL_SECONDS);
});

test("unknown keys are found at the top level and inside targets", () => {
  const raw = {
    intervalSeconds: 60,
    repos: [{ repo: "acme/app", interval: 30 }],
    orgs: [{ org: "acme", bogus: true }],
  };

  assert.deepEqual(findUnknownKeys(raw), ["intervalSeconds", "repos[0].interval", "orgs[0].bogus"]);
  assert.deepEqual(findUnknownKeys({ $schema: "x", repos: [{ repo: "a/b" }], stateDir: "/s" }), []);
});

test("the example config and the README example stay valid and free of unknown keys", () => {
  const example = JSON.parse(readFileSync(join(root, "pollhook.example.json"), "utf8"));
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const block = /## Configuration[\s\S]*?\n( {4}\{[\s\S]*?\n {4}\})\n/.exec(readme)?.[1];
  assert.ok(block, "README has a configuration example");
  const documented = JSON.parse(block);

  for (const raw of [example, documented]) {
    assert.deepEqual(findUnknownKeys(raw), []);
    assert.doesNotThrow(() => parseConfig(raw, "example.json"));
  }
});
