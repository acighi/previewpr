import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    exclude: ["review-app/**", "dist/**", "node_modules/**"],
  },
});
