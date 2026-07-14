import { defineConfig } from "vitest/config";

/**
 * Node-runtime tests (packages touching native modules like better-sqlite3 or
 * microsandbox must NOT run under `bun test`). Pure-logic packages use bun test.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.vitest.ts", "packages/**/*.node.test.ts", "apps/**/*.node.test.ts"],
  },
});
