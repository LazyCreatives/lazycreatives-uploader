/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

// base: "./" so the packaged renderer loads its assets over file:// correctly.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: Number(process.env.LAZYUP_VITE_PORT) || 5173, strictPort: true },
  // e2e/ holds the Playwright picture tests (npm run test:screens), not unit tests.
  test: { environment: "jsdom", exclude: [...configDefaults.exclude, "e2e/**"] },
});
