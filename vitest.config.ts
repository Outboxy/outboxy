import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*"],

    coverage: {
      provider: "v8",
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 90,
      },
      reporter: ["text", "json-summary", "lcov", "html"],
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "packages/schema/src/**",
        "packages/publisher-core/src/**",
        "packages/db-adapter-core/src/interfaces/**",
        "packages/dialect-core/src/**",
        "packages/testing-utils/src/**",
        "packages/server/src/load-testing/**",
        "packages/*/src/index.ts",
      ],
    },
  },
});
