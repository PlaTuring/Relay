import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    include: ["tests/**/*.spec.ts"]
  }
});
