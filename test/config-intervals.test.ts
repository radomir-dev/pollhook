import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.ts";
import { ADAPTERS } from "../src/registry.ts";
import { resolveInterval, resolveStrategy } from "../src/poller/schedule.ts";
import { tempStateDir } from "./helpers.ts";

function load(raw: unknown) {
  const dir = tempStateDir();
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(raw));
  return loadConfig(path);
}

const repos = [{ repo: "acme/app", events: ["workflow_run", "check_run"], intervalSeconds: 60 }];
const run = ADAPTERS.workflow_run;
const check = ADAPTERS.check_run;

test("a repository event interval beats the global one and the target interval", () => {
  const config = load({
    intervalSeconds: 30,
    intervals: { workflow_run: 10, check_run: 45 },
    repos: [{ ...repos[0], intervals: { check_run: 120 } }],
  });
  const repo = config.repos[0]!;

  assert.equal(resolveInterval(config, repo, run), 10_000);
  assert.equal(resolveInterval(config, repo, check), 120_000);
});

test("the target interval applies when no event override exists", () => {
  const config = load({ repos });

  assert.equal(resolveInterval(config, config.repos[0]!, check), 60_000);
});

test("strategies resolve per event, target first then global, defaulting to fixed", () => {
  const config = load({
    strategies: { workflow_run: "while-active" },
    repos: [{ ...repos[0], strategies: { check_run: "while-active" } }],
  });
  const repo = config.repos[0]!;

  assert.equal(resolveStrategy(config, repo, run), "while-active");
  assert.equal(resolveStrategy(config, repo, check), "while-active");
  assert.equal(resolveStrategy(load({ repos }), load({ repos }).repos[0]!, run), "fixed");
});

test("an interval below the five second floor or an unknown event is rejected", () => {
  assert.throws(
    () => load({ intervals: { workflow_run: 2 }, repos }),
    /intervals.workflow_run must be at least 5 seconds/,
  );
  assert.throws(
    () => load({ intervals: { discussion: 30 }, repos }),
    /discussion is not a subscribed event/,
  );
});

test("an unknown strategy is rejected", () => {
  assert.throws(
    () => load({ strategies: { workflow_run: "adaptive" }, repos }),
    /must be fixed or while-active/,
  );
});
