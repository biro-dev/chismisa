import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    // Node environment by default (server actions, libs); component tests
    // opt into jsdom via the `@vitest-environment jsdom` docblock.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The real `server-only` package throws outside a RSC bundler context.
      "server-only": path.resolve(__dirname, "./src/test/stubs/server-only.ts"),
    },
  },
});