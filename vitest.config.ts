import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * The tests run with a connection pool of 3, the size CI's runner gives Prisma
 * (cores * 2 + 1 there; production's serverless pools are small too). A bigger
 * local pool hid a pool-starvation deadlock (a query on the global client inside
 * an interactive transaction needs a second connection, #124) that only CI
 * showed. An explicit `connection_limit` in DATABASE_URL wins, and the URL comes
 * from the environment or, as for Prisma itself, from `.env`.
 */
const TEST_POOL_SIZE = 3;
const databaseUrl = process.env.DATABASE_URL ?? loadEnv("test", process.cwd(), "").DATABASE_URL;
if (databaseUrl && !/[?&]connection_limit=/.test(databaseUrl)) {
  process.env.DATABASE_URL = `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}connection_limit=${TEST_POOL_SIZE}`;
}

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Ensures exactly one base Framework exists for the run (see the file).
    globalSetup: ["./vitest.global-setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
