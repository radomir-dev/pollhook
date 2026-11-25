import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliMarkdown, replaceSection, replaceToc } from "../src/cli/docs.ts";

const readme = join(import.meta.dirname, "..", "README.md");
const current = readFileSync(readme, "utf8");
const next = replaceToc(replaceSection(current, cliMarkdown()));

if (process.argv.includes("--check")) {
  if (next !== current) {
    process.stderr.write("README CLI section is stale: run `npm run docs`\n");
    process.exit(1);
  }
  process.stdout.write("README CLI section is current\n");
} else {
  writeFileSync(readme, next);
  process.stdout.write("README CLI section updated\n");
}
