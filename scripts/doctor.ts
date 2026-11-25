import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { Listr } from "listr2";

const run = promisify(execFile);
const root = join(import.meta.dirname, "..");

const COVERAGE_FLOORS = { lines: 85, branches: 70, funcs: 80 };

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

function coverageRow(output: string): { lines: number; branches: number; funcs: number } {
  const row = output.split("\n").find((line) => line.includes("all files"));
  if (!row) throw new Error("coverage report has no summary row");
  const cells = row.split("|").map((cell) => cell.trim());
  return {
    lines: Number(cells[1]),
    branches: Number(cells[2]),
    funcs: Number(cells[3]),
  };
}

function assertFloors(actual: { lines: number; branches: number; funcs: number }): void {
  const failures = Object.entries(COVERAGE_FLOORS)
    .filter(([key, floor]) => actual[key as keyof typeof actual] < floor)
    .map(([key, floor]) => `${key} ${actual[key as keyof typeof actual]}% < ${floor}%`);
  if (failures.length > 0) throw new Error(`coverage below floor: ${failures.join(", ")}`);
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
    task("Dead code and unused dependencies", async () => {
      await exec("npx", "knip", "--no-progress");
      return "nothing unused";
    }),
    task("Dependency audit", async () => {
      await exec("npm", "audit", "--audit-level=high");
      return "no high or critical advisories";
    }),
    task("Tests and coverage", async () => {
      const { stdout, stderr } = await exec(
        process.execPath,
        "--test",
        "--experimental-test-coverage",
        "test/*.test.ts",
      );
      const actual = coverageRow(`${stdout}\n${stderr}`);
      assertFloors(actual);
      return `all tests pass; lines ${actual.lines}%, branches ${actual.branches}%, functions ${actual.funcs}%`;
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
