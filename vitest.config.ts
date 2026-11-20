import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/core/test/**/*.test.ts", "apps/worker/test/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["apps/worker/test/integration/**/*.test.ts"],
          environment: "node",
          testTimeout: 90_000,
          hookTimeout: 90_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "sql",
          include: ["supabase/tests/**/*.test.ts"],
          environment: "node",
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
