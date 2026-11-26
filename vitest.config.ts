import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

const sandbox = join(tmpdir(), "pollhook-vitest");
mkdirSync(join(sandbox, "home"), { recursive: true });
mkdirSync(join(sandbox, "run"), { recursive: true });

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      HOME: join(sandbox, "home"),
      XDG_RUNTIME_DIR: join(sandbox, "run"),
      POLLHOOK_CONFIG: join(sandbox, "no-such-config.json"),
      POLLHOOK_TOKEN: "test-token",
      POLLHOOK_API_URL: "http://127.0.0.1:9",
      POLLHOOK_NO_AUTOSTART: "1",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text-summary", "html", "lcov"],
      thresholds: { lines: 80, statements: 75, branches: 65, functions: 80 },
    },
  },
});
