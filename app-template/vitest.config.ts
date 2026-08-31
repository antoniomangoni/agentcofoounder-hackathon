import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    passWithNoTests: false,
    setupFiles: ["./src/test/setup.ts"],
    exclude: [...configDefaults.exclude, "**/*.kernel.test.ts", "**/*.kernel.test.tsx"],
  },
});
