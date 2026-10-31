import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/app/routes/a2ui-1.0/**/*.test.ts"],
  },
});
