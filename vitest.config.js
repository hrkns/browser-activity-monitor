import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    environment: "node",
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["**/*.js"],
      exclude: [
        "**/*.config.js",
        "coverage/**",
        "e2e/**",
        "node_modules/**",
        "playwright-report/**",
        "test-results/**",
        "tests/**"
      ],
      reportsDirectory: "coverage",
      reporter: ["text", "json-summary", "html", "lcov"],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
        perFile: true
      }
    }
  }
});
