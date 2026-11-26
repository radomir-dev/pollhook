import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { runConfigCommand } from "../src/cli/config-commands.ts";
import { loadConfig } from "../src/config.ts";
import { tempStateDir } from "./helpers.ts";

function run(command: string, args: string[]): { code: number | undefined; out: string } {
  const write = process.stdout.write.bind(process.stdout);
  let out = "";
  process.stdout.write = ((chunk: string) => ((out += chunk), true)) as typeof process.stdout.write;
  try {
    return { code: runConfigCommand(command, args), out };
  } finally {
    process.stdout.write = write;
  }
}

function fresh(): string {
  return join(tempStateDir(), "pollhook", "config.json");
}

test("init writes a config that loads, creating the directory", () => {
  const path = fresh();
  const result = run("init", [
    "--config",
    path,
    "--repo",
    "acme/app",
    "--repo",
    "acme/lib",
    "--events",
    "push,release",
  ]);
  const config = loadConfig(path);

  assert.equal(result.code, 0);
  assert.deepEqual(
    config.repos.map((repo) => repo.repo),
    ["acme/app", "acme/lib"],
  );
  assert.deepEqual(config.repos[0]!.events, ["push", "release"]);
  assert.match(result.out, /next: pollhook status/);
});

test("init without a repo writes a placeholder and says to edit it", () => {
  const path = fresh();
  const result = run("init", ["--config", path]);

  assert.equal(loadConfig(path).repos[0]!.repo, "owner/name");
  assert.match(result.out, /replace owner\/name with a repository/);
});

test("init refuses to overwrite unless forced, and never writes an invalid file", () => {
  const path = fresh();
  run("init", ["--config", path, "--repo", "acme/app"]);
  const original = readFileSync(path, "utf8");

  assert.throws(
    () => run("init", ["--config", path, "--repo", "acme/other"]),
    /already exists.*--force/,
  );
  assert.equal(readFileSync(path, "utf8"), original);

  run("init", ["--config", path, "--repo", "acme/other", "--force"]);
  assert.equal(loadConfig(path).repos[0]!.repo, "acme/other");

  const empty = fresh();
  assert.throws(() => run("init", ["--config", empty, "--events", "pushh"]), /not available/);
  assert.equal(existsSync(empty), false);
});

test("check prints the resolved interval and strategy, with the adapter floor applied", () => {
  const path = fresh();
  run("init", [
    "--config",
    path,
    "--repo",
    "acme/app",
    "--events",
    "workflow_run,dependabot_alert",
  ]);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(
    path,
    JSON.stringify({
      ...raw,
      intervals: { workflow_run: 10, dependabot_alert: 60 },
      strategies: { workflow_run: "while-active" },
    }),
  );

  const result = run("config", ["check", "--config", path]);

  assert.equal(result.code, 0);
  assert.match(result.out, /is valid/);
  assert.match(result.out, /workflow_run\s+every\s+10s\s+while-active/);
  assert.match(result.out, /dependabot_alert\s+every\s+300s\s+fixed/);
});

test("check lists organisation targets with their own events", () => {
  const path = fresh();
  run("init", ["--config", path, "--repo", "acme/app"]);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...raw, orgs: [{ org: "acme", events: ["team"] }] }));

  assert.match(
    run("config", ["check", "--config", path]).out,
    /acme \(organisation\)\n\s+team\s+every\s+300s/,
  );
});

test("check warns about keys it ignores but still passes", () => {
  const path = fresh();
  run("init", ["--config", path, "--repo", "acme/app"]);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...raw, intervalSeconds: 60 }));
  const writeErr = process.stderr.write.bind(process.stderr);
  let err = "";
  process.stderr.write = ((chunk: string) => ((err += chunk), true)) as typeof process.stderr.write;
  try {
    assert.equal(run("config", ["check", "--config", path]).code, 0);
  } finally {
    process.stderr.write = writeErr;
  }

  assert.match(err, /"intervalSeconds" is not a known key and is ignored/);
});

test("check fails on an invalid config", () => {
  const path = fresh();
  run("init", ["--config", path, "--repo", "acme/app"]);
  writeFileSync(path, JSON.stringify({ repos: [{ repo: "acme/app", intervalSeconds: 1 }] }));

  assert.throws(() => run("config", ["check", "--config", path]), /at least 5/);
});

test("add-repo and remove-repo round-trip and keep unrelated keys", () => {
  const path = fresh();
  run("init", ["--config", path, "--repo", "acme/app"]);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...raw, deliver: { url: "http://127.0.0.1:7345/hook" } }));
  const before = JSON.parse(readFileSync(path, "utf8"));

  run("config", ["add-repo", "acme/lib", "--events", "push", "--interval", "30", "--config", path]);
  const added = loadConfig(path);
  assert.deepEqual(
    added.repos.map((repo) => repo.repo),
    ["acme/app", "acme/lib"],
  );
  assert.equal(added.repos[1]!.intervalMs, 30_000);
  assert.ok(added.deliver);

  run("config", ["remove-repo", "acme/lib", "--config", path]);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), before);
});

test("a rejected edit leaves the file byte for byte untouched", () => {
  const path = fresh();
  run("init", ["--config", path, "--repo", "acme/app"]);
  const original = readFileSync(path, "utf8");

  assert.throws(
    () => run("config", ["add-repo", "acme/app", "--config", path]),
    /already configured/,
  );
  assert.throws(
    () => run("config", ["add-repo", "acme/lib", "--events", "pushh", "--config", path]),
    /not available/,
  );
  assert.throws(
    () => run("config", ["remove-repo", "acme/ghost", "--config", path]),
    /not configured/,
  );
  assert.throws(
    () => run("config", ["remove-repo", "acme/app", "--config", path]),
    /at least one of repos or orgs/,
  );
  assert.equal(readFileSync(path, "utf8"), original);
  assert.deepEqual(readdirSync(join(path, "..")), ["config.json"]);
});

test("config without a known action, and unrelated commands, are not handled here", () => {
  assert.throws(() => run("config", []), /check, add-repo, remove-repo/);
  assert.equal(runConfigCommand("status", []), undefined);
});
