import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "volunteer-hours-*.spec.ts",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4436",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    },
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4436 --strictPort",
    url: "http://127.0.0.1:4436",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "https://attendance-test.supabase.invalid",
      VITE_SUPABASE_ANON_KEY: "test-public-key",
    },
  },
});
