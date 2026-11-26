import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import {
  cliMarkdown,
  END,
  replaceSection,
  replaceToc,
  START,
  tocMarkdown,
} from "../src/cli/docs.ts";
import { COMMANDS, invocation } from "../src/cli/spec.ts";
import { USAGE } from "../src/cli/usage.ts";

const root = join(import.meta.dirname, "..");

test("every command the CLI dispatches has a spec entry", () => {
  const source = readFileSync(join(root, "src/cli/commands.ts"), "utf8");
  const handlers = source.slice(source.indexOf("const handlers"), source.indexOf("};"));

  for (const name of handlers.matchAll(/^\s{2}(\w+):/gm)) {
    assert.ok(
      COMMANDS.some((command) => command.name === name[1]),
      `${name[1]} has a handler but no spec entry`,
    );
  }
});

test("the spec and the usage text list the same commands", () => {
  for (const command of COMMANDS) {
    assert.ok(USAGE.includes(invocation(command)), `${command.name} missing from --help`);
  }
});

test("the markdown block lists every command and escapes table separators", () => {
  const markdown = cliMarkdown();

  for (const command of COMMANDS) {
    assert.ok(markdown.includes(command.name), `${command.name} missing from the markdown`);
  }
  assert.ok(markdown.startsWith(START));
  assert.ok(markdown.endsWith(END));
  assert.ok(!/\| `pollhook pr <pr> --until merged\|closed/.test(markdown));
  assert.ok(markdown.includes("merged\\|closed"));
});

test("the committed README carries the generated block unchanged", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");

  assert.equal(replaceSection(readme, cliMarkdown()), readme);
});

test("a README without markers is rejected instead of silently unchanged", () => {
  assert.throws(() => replaceSection("# no markers here\n", cliMarkdown()), /missing the/);
});

test("the table of contents lists every section slug", () => {
  const readme = "# Title\n\n## Why\n\n## CLI reference\n\n## Name & identity\n";
  const toc = tocMarkdown(readme);

  assert.match(toc, /1\. \[Why\]\(#why\)/);
  assert.match(toc, /1\. \[CLI reference\]\(#cli-reference\)/);
  assert.match(toc, /1\. \[Name & identity\]\(#name-identity\)/);
});

test("the committed README carries the generated table of contents", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");

  assert.equal(replaceToc(readme), readme);
});
