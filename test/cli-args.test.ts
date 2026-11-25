import assert from "node:assert/strict";
import test from "node:test";
import { parseDuration, positionals, required, valueFlag, values } from "../src/cli/args.ts";

test("parseDuration understands seconds, minutes, hours and bare seconds", () => {
  assert.equal(parseDuration(undefined, 1_800_000), 1_800_000);
  assert.equal(parseDuration("45s", 0), 45_000);
  assert.equal(parseDuration("90", 0), 90_000);
  assert.equal(parseDuration("30m", 0), 1_800_000);
  assert.equal(parseDuration("2h", 0), 7_200_000);
  assert.throws(() => parseDuration("soon", 0), /invalid --timeout/);
});

test("positionals skip flags and the values they consume", () => {
  assert.deepEqual(positionals(["7", "--repo", "acme/app", "--timeout", "30m"]), ["7"]);
  assert.deepEqual(positionals(["--json", "status"]), ["status"]);
  assert.deepEqual(positionals(["--match", "a=b", "5"]), ["5"]);
});

test("values collects a repeated flag", () => {
  assert.deepEqual(values(["--match", "a=1", "--match", "b=2"], "--match"), ["a=1", "b=2"]);
  assert.deepEqual(values(["--match"], "--match"), []);
});

test("valueFlag takes the token after the flag", () => {
  assert.equal(valueFlag(["--repo", "acme/app"], "--repo"), "acme/app");
  assert.equal(valueFlag([], "--repo"), undefined);
});

test("required rejects missing and empty values", () => {
  assert.equal(required("7", "run id"), "7");
  assert.throws(() => required(undefined, "run id"), /missing run id/);
  assert.throws(() => required("", "run id"), /missing run id/);
});
