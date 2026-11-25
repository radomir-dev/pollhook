import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliMarkdown, replaceSection, replaceToc } from "../src/cli/docs.ts";
import { configSchema } from "../src/config/schema.ts";

const root = join(import.meta.dirname, "..");
const generated = [
  {
    path: join(root, "README.md"),
    build: (current: string) => replaceToc(replaceSection(current, cliMarkdown())),
  },
  {
    path: join(root, "pollhook.schema.json"),
    build: () => `${JSON.stringify(configSchema(), null, 2)}\n`,
  },
];

const check = process.argv.includes("--check");
const stale: string[] = [];
for (const file of generated) {
  const current = existsSync(file.path) ? readFileSync(file.path, "utf8") : "";
  const next = file.build(current);
  if (next === current) continue;
  stale.push(file.path);
  if (!check) writeFileSync(file.path, next);
}

if (check && stale.length > 0) {
  process.stderr.write(`generated files are stale: run \`npm run docs\`\n${stale.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(check ? "generated files are current\n" : "generated files updated\n");
