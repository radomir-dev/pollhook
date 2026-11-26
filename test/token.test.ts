import assert from "node:assert/strict";
import { test } from "vitest";
import { resolveToken } from "../src/github.ts";

test("POLLHOOK_TOKEN wins over every other source", () => {
  const token = resolveToken(
    { POLLHOOK_TOKEN: "explicit", GH_TOKEN: "gh-env", GITHUB_TOKEN: "env" } as NodeJS.ProcessEnv,
    () => "gh",
  );
  assert.equal(token, "explicit");
});

test("the gh login wins over ambient environment tokens", () => {
  const token = resolveToken({ GITHUB_TOKEN: "env" } as NodeJS.ProcessEnv, () => "gh-login");
  assert.equal(token, "gh-login");
});

test("environment tokens are the fallback when gh has no login", () => {
  assert.equal(
    resolveToken({ GITHUB_TOKEN: "env" } as NodeJS.ProcessEnv, () => ""),
    "env",
  );
  assert.equal(
    resolveToken({ GH_TOKEN: "gh-env" } as NodeJS.ProcessEnv, () => ""),
    "gh-env",
  );
});

test("no token anywhere is an error", () => {
  assert.throws(() => resolveToken({} as NodeJS.ProcessEnv, () => ""), /no GitHub token/);
});
