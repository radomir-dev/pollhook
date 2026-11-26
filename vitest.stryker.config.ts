import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.ts";

export default mergeConfig(
  base,
  defineConfig({
    test: {
      exclude: ["test/autostart.test.ts", "test/emit.test.ts", "test/cli-e2e.test.ts"],
      coverage: { enabled: false },
    },
  }),
);
