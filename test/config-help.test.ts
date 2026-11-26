import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import { loadConfig, parseConfig } from "../src/config.ts";
import { tempStateDir } from "./helpers.ts";

test("a missing config explains where it is expected and how to create it", () => {
  const path = join(tempStateDir(), "missing.json");

  assert.throws(
    () => loadConfig(path),
    (error: Error) => {
      assert.ok(error.message.includes(path));
      assert.match(error.message, /pollhook init/);
      assert.match(error.message, /--config PATH or POLLHOOK_CONFIG/);
      assert.match(error.message, /"repos": \[\{ "repo": "owner\/name"/);
      return true;
    },
  );
});

test("a config that exists but is not JSON keeps the parse error", () => {
  const path = join(tempStateDir(), "broken.json");
  writeFileSync(path, "{ nope");

  assert.throws(() => loadConfig(path), /cannot read config .*broken\.json/);
});

test("an unknown event points at the event catalog", () => {
  const raw = { repos: [{ repo: "acme/app", events: ["pushh"] }] };

  assert.throws(
    () => parseConfig(raw, "config.json"),
    /event "pushh" is not available[\s\S]*docs\/events\.md/,
  );
});
