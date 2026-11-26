import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { Listr } from "listr2";

const run = promisify(execFile);
const root = join(import.meta.dirname, "..");

interface Result {
  stdout: string;
  stderr: string;
}

async function exec(command: string, ...args: string[]): Promise<Result> {
  try {
    const result = await run(command, args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error: any) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join("\n").trim();
    throw new Error(detail || error.message);
  }
}

const failures: string[] = [];

const task = (title: string, body: () => Promise<string>) => ({
  title,
  task: async () => {
    try {
      return await body();
    } catch (error) {
      failures.push(title);
      throw error;
    }
  },
});

const tasks = new Listr(
  [
    task("Typecheck", async () => {
      await exec("npx", "tsc", "--noEmit");
      return "no type errors";
    }),
    task("Lint", async () => {
      await exec("npx", "oxlint", "src", "test", "scripts");
      return "no findings";
    }),
    task("Format", async () => {
      await exec("npx", "oxfmt", "--check", "src", "test", "scripts");
      return "formatting is current";
    }),
    task("Architecture", async () => {
      await exec(
        "npx",
        "depcruise",
        "src",
        "test",
        "scripts",
        "--config",
        ".dependency-cruiser.cjs",
      );
      return "no cycles and no layer violations";
    }),
    task("Dead code and unused dependencies", async () => {
      await exec("npx", "knip", "--no-progress");
      return "nothing unused";
    }),
    task("Dependency audit", async () => {
      await exec("npm", "audit", "--audit-level=high");
      return "no high or critical advisories";
    }),
    task("Tests and coverage", async () => {
      const { stdout } = await exec("npx", "vitest", "run", "--coverage");
      const tests = /Tests\s+(\d+) passed/.exec(stdout)?.[1];
      const lines = /Lines\s+:\s+([\d.]+)%/.exec(stdout)?.[1];
      return `${tests} tests pass; ${lines}% of lines covered, above the floors in vitest.config.ts`;
    }),
    task("Generated docs", async () => {
      await exec("node", "scripts/cli-docs.ts", "--check");
      return "README is current";
    }),
    task("Build and package", async () => {
      await exec("npm", "run", "build");
      await exec("npx", "publint", "--strict");
      const help = await exec(process.execPath, "dist/cli.js", "--help");
      if (!help.stdout.includes("pollhook: GitHub webhook deliveries")) {
        throw new Error("the built CLI does not answer --help");
      }
      return "builds, packs and runs";
    }),
  ],
  { concurrent: true, exitOnError: false, rendererOptions: { showErrorMessage: true } },
);

await tasks.run();

if (failures.length > 0) {
  process.stderr.write(`\ndoctor: ${failures.length} check(s) failed: ${failures.join(", ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("\ndoctor: all checks passed\n");
}
